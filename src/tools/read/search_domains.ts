import { z } from "zod";
import { checkDomainsBatch } from "../../cloudflare/registrar.js";
import { listZones } from "../../cloudflare/zones.js";
import { getPorkbunPricing } from "../../porkbun/pricing.js";
import { textContent } from "../../types.js";

export const name = "search_domains";
export const description =
    "Search for available domain names across multiple registrars (Cloudflare, Porkbun). Checks TLDs not supported by CF API via Porkbun. Shows availability and pricing comparison. Pass multiple keywords to check all at once instead of calling this tool repeatedly.";

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

    type RowResult = {
        domain: string;
        cfAvailable: boolean | null;
        pbAvailable: boolean | null;
        owned: boolean;
        cfPrice?: string;
        pbPrice?: string;
        reason?: string;
    };
    const results: RowResult[] = allDomains.map((domain) => {
        if (ownedZones.has(domain)) return { domain, cfAvailable: false, pbAvailable: false, owned: true };

        const r = cfMap.get(domain);
        const tld = domain.split(".").slice(-1)[0];
        const pb = pbPricing.get(tld);

        let cfAvailable: boolean | null = null;
        let cfPrice: string | undefined;
        let reason: string | undefined;

        if (!r) {
            cfAvailable = null;
        } else if (r.registrable) {
            cfAvailable = true;
            if (r.pricing) cfPrice = `$${r.pricing.registration_cost}`;
        } else if (r.reason === "domain_unavailable") {
            cfAvailable = false;
        } else if (r.reason === "extension_not_supported_via_api" || r.reason === "extension_not_supported") {
            cfAvailable = null;
            reason =
                r.reason === "extension_not_supported_via_api"
                    ? "CF dashboard only"
                    : "TLD not in CF Registrar";
        } else if (r.reason === "domain_premium") {
            cfAvailable = true;
            if (r.pricing) cfPrice = `$${r.pricing.registration_cost}*`;
        }

        const pbAvailable = pb ? true : null;
        const pbPrice = pb ? `$${pb.registration}` : undefined;

        return {
            domain,
            cfAvailable,
            pbAvailable,
            owned: false,
            cfPrice,
            pbPrice,
            reason,
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

        lines.push(
            `${"Domain".padEnd(25)} ${"CF".padEnd(12)} ${"PB".padEnd(12)} ${"CF Price".padEnd(13)} ${"PB Price"}`,
        );
        lines.push(`${"-".repeat(85)}`);

        for (const r of kwResults) {
            if (args.available_only && !r.owned && r.cfAvailable !== true && r.pbAvailable !== true) continue;

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
        }
        lines.push("");
    }

    const available = results.filter(
        (r) => (r.cfAvailable === true || r.pbAvailable === true) && !r.owned,
    );
    lines.push(
        `**Summary:** ${available.length}/${results.length} available (CF or Porkbun)`,
    );
    if (available.length > 0) {
        const cfReg = available.find((r) => r.cfAvailable === true);
        const pbReg = available.find((r) => r.pbAvailable === true && r.cfAvailable !== true);
        if (cfReg) {
            lines.push(`\nCF available: \`register_domain({ domain: "${cfReg.domain}" })\``);
        }
        if (pbReg) {
            lines.push(
                `Porkbun available: register at porkbun.com for \`${pbReg.domain}\``,
            );
        }
    }

    return textContent(lines.join("\n"));
}
