import { z } from "zod";
import { checkDomainsBatch } from "../../cloudflare/registrar.js";
import { listZones } from "../../cloudflare/zones.js";
import { getPorkbunPricing } from "../../porkbun/pricing.js";
import { checkPorkbunDomainsBatch } from "../../porkbun/availability.js";
import { textContent } from "../../types.js";

export const name = "search_domains";
export const description =
    "Search for available domain names across multiple keywords and TLDs. Checks availability via Cloudflare Registrar API. For TLDs not fully supported by CF (e.g., .ai, .dev premium names), checks actual availability via Porkbun API (if PORKBUN_API_KEY/SECRET configured). Shows dual-provider availability and pricing comparison. Pass multiple keywords to check all at once instead of calling this tool repeatedly.";

export const inputSchema = z.object({
    keywords: z
        .union([z.string().min(1).max(63), z.array(z.string().min(1).max(63)).min(1).max(20)])
        .describe("Keyword(s) or brand name(s) to search (without TLD), e.g. 'myapp' or ['myapp', 'mysite', 'mybrand']. Pass multiple to check all at once."),
    tlds: z
        .array(z.string().regex(/^[a-z]{2,}$/i))
        .min(1)
        .max(20)
        .default(["com", "net", "org", "io", "co", "app", "dev", "ai", "xyz", "me"])
        .describe("TLDs to check. Defaults to 10 popular ones. Max 20."),
    available_only: z.boolean().default(false).describe("Only show available domains"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const keywords = (Array.isArray(args.keywords) ? args.keywords : [args.keywords])
        .map((k) => k.toLowerCase().trim());
    const tlds = args.tlds.map((t) => t.toLowerCase().replace(/^\./, ""));

    // Pre-fetch user's existing zones for instant "owned" status
    const ownedZones = new Set<string>();
    try {
        const zones = await listZones();
        zones.forEach((z) => ownedZones.add(z.name));
    } catch { /* non-fatal */ }

    // Fetch Porkbun pricing for all TLDs upfront (parallel)
    const pbPricing = await getPorkbunPricing(tlds);

    // Build full matrix and separate owned from those needing check
    const allDomains = keywords.flatMap((kw) => tlds.map((tld) => `${kw}.${tld}`));
    const toCheck = allDomains.filter((d) => !ownedZones.has(d));

    // CF batch check — up to 20 per request, chunked automatically
    const cfResults = await checkDomainsBatch(toCheck);
    const cfMap = new Map(cfResults.map((r) => [r.name, r]));

    // Identify domains to verify on Porkbun:
    // 1. Domains where CF says unsupported TLD
    // 2. Domains where CF says available (verify to catch false positives)
    // Note: Porkbun rate limit is 1 check per 10 seconds per account.
    // Cap at 3 total to avoid long waits (~33s max). For deeper checks use check_domain().
    const pbCheckCandidates: string[] = [];
    toCheck.forEach((d) => {
        const r = cfMap.get(d);
        if (!r) return;
        if (r.reason === "extension_not_supported_via_api" || r.reason === "extension_not_supported") {
            pbCheckCandidates.push(d);
        } else if (r.registrable) {
            pbCheckCandidates.push(d);
        }
    });
    const pbCheckNeeded = pbCheckCandidates.slice(0, 3);

    const pbAvailability = await checkPorkbunDomainsBatch(pbCheckNeeded);

    type RowResult = {
        domain: string;
        cfAvailable: boolean | null;
        pbAvailable: boolean | null;
        owned: boolean;
        cfPrice?: string;
        pbPrice?: string;
        reason?: string;
        verified?: boolean; // true if Porkbun verified the availability
    };
    const results: RowResult[] = allDomains.map((domain) => {
        if (ownedZones.has(domain)) return { domain, cfAvailable: false, pbAvailable: false, owned: true };

        const r = cfMap.get(domain);
        const tld = domain.split(".").slice(-1)[0];
        const pb = pbPricing.get(tld);
        const pbAvail = pbAvailability.get(domain);

        let cfAvailable: boolean | null = null;
        let pbAvailableResult: boolean | null = null;
        let cfPrice: string | undefined;
        let pbPrice: string | undefined;
        let reason: string | undefined;
        let verified = false;

        if (!r) {
            cfAvailable = null;
        } else if (r.registrable) {
            cfAvailable = true;
            if (r.pricing) cfPrice = `$${r.pricing.registration_cost}`;
            // If Porkbun says otherwise, trust Porkbun
            if (pbAvail) {
                pbAvailableResult = pbAvail.available ? true : false;
                pbPrice = pbAvail.registration ? `$${pbAvail.registration}` : pb ? `$${pb.registration}` : undefined;
                verified = true;
                // If Porkbun contradicts CF, downgrade CF status
                if (!pbAvail.available) {
                    cfAvailable = false;
                    reason = "CF mismatch — Porkbun shows taken";
                }
            }
        } else if (r.reason === "domain_unavailable") {
            cfAvailable = false;
        } else if (r.reason === "extension_not_supported_via_api" || r.reason === "extension_not_supported") {
            cfAvailable = null;
            reason =
                r.reason === "extension_not_supported_via_api"
                    ? "CF API unsupported"
                    : "TLD not in CF";
            // Fall back to Porkbun availability if we have it
            if (pbAvail) {
                pbAvailableResult = pbAvail.available ? true : false;
                pbPrice = pbAvail.registration ? `$${pbAvail.registration}` : pb ? `$${pb.registration}` : undefined;
                verified = true;
            } else if (pb) {
                pbPrice = `$${pb.registration}`;
            }
        } else if (r.reason === "domain_premium") {
            cfAvailable = true;
            if (r.pricing) cfPrice = `$${r.pricing.registration_cost}*`;
            // Verify premium domains on Porkbun too
            if (pbAvail) {
                pbAvailableResult = pbAvail.available ? true : false;
                pbPrice = pbAvail.registration ? `$${pbAvail.registration}` : pb ? `$${pb.registration}` : undefined;
                verified = true;
            }
        }

        // If CF had no issue but we didn't get Porkbun data, use pricing as reference
        if (!verified && !pbPrice && pb) {
            pbPrice = `$${pb.registration}`;
        }

        return {
            domain,
            cfAvailable,
            pbAvailable: pbAvailableResult,
            owned: false,
            cfPrice,
            pbPrice,
            reason,
            verified,
        };
    });

    const lines: string[] = [
        `## Domain Search: ${keywords.map((k) => `"${k}"`).join(", ")}`,
        `Checked ${results.length} combinations (${keywords.length} keyword(s) × ${tlds.length} TLD(s))`,
        `Pricing from: Cloudflare Registrar & Porkbun\n`,
    ];

    const grouped = keywords.length > 1;
    for (const kw of keywords) {
        const kwResults = results.filter((r) => r.domain.startsWith(`${kw}.`));
        if (grouped) {
            const avail = kwResults.filter(
                (r) => (r.cfAvailable === true || r.pbAvailable === true) && !r.owned,
            ).length;
            lines.push(`### "${kw}" — ${avail} available`);
        }

        // Check if any have Porkbun availability data
        const hasPorkbunAvail = kwResults.some((r) => r.pbAvailable !== null && r.pbAvailable !== undefined);

        if (hasPorkbunAvail) {
            lines.push(
                `${"Domain".padEnd(25)} ${"CF".padEnd(12)} ${"PB".padEnd(12)} ${"CF Price".padEnd(13)} ${"PB Price"}`,
            );
        } else {
            lines.push(
                `${"Domain".padEnd(25)} ${"Status".padEnd(18)} ${"CF Price".padEnd(13)} ${"PB Ref Price"}`,
            );
        }
        lines.push(`${"-".repeat(80)}`);

        for (const r of kwResults) {
            if (args.available_only && !r.owned && r.cfAvailable !== true && r.pbAvailable !== true) continue;

            if (hasPorkbunAvail) {
                const cfStatus = r.owned
                    ? "yours"
                    : r.cfAvailable === true
                        ? "avail ✅"
                        : r.cfAvailable === false
                            ? "taken ❌"
                            : "unknown ❓";

                const pbStatus = r.pbAvailable === true ? "avail ✅" : r.pbAvailable === false ? "taken ❌" : "-";

                const cfPrice = r.cfPrice ? r.cfPrice : r.reason ? `(${r.reason})` : "-";
                const pbPrice = r.pbPrice ? r.pbPrice : "-";

                lines.push(
                    `${r.domain.padEnd(25)} ${cfStatus.padEnd(12)} ${pbStatus.padEnd(12)} ${cfPrice.padEnd(13)} ${pbPrice}`,
                );
            } else {
                const cfStatus = r.owned
                    ? "yours ✅"
                    : r.cfAvailable === true
                        ? "available ✅"
                        : r.cfAvailable === false
                            ? "taken ❌"
                            : "unknown ❓";

                const cfPrice = r.cfPrice ? r.cfPrice : r.reason ? `(${r.reason})` : "-";
                const pbPrice = r.pbPrice ? r.pbPrice : "-";

                lines.push(
                    `${r.domain.padEnd(25)} ${cfStatus.padEnd(18)} ${cfPrice.padEnd(13)} ${pbPrice}`,
                );
            }
        }
        lines.push("");
    }

    const cfAvailable = results.filter(
        (r) => r.cfAvailable === true && !r.owned,
    );
    const pbAvailable = results.filter(
        (r) => r.pbAvailable === true && !r.owned,
    );
    const totalAvailable = results.filter(
        (r) => (r.cfAvailable === true || r.pbAvailable === true) && !r.owned,
    );

    lines.push(
        `**Summary:** ${totalAvailable.length}/${results.length} available (${cfAvailable.length} CF, ${pbAvailable.length} Porkbun)`,
    );

    if (cfAvailable.length > 0) {
        const first = cfAvailable[0];
        lines.push(`\nCF available: \`register_domain({ domain: "${first.domain}" })\``);
    }
    if (pbAvailable.length > 0 && pbAvailable.some((r) => !cfAvailable.find((c) => c.domain === r.domain))) {
        const first = pbAvailable.find((r) => !cfAvailable.find((c) => c.domain === r.domain));
        if (first) {
            lines.push(`Porkbun available: \`${first.domain}\` - register at https://porkbun.com`);
        }
    }

    lines.push(
        `\n*Note: Porkbun rate limit is 1 check/10s — only first ${pbCheckNeeded.length} candidates verified. Use check_domain() for full per-domain Porkbun check.*`,
    );

    return textContent(lines.join("\n"));
}
