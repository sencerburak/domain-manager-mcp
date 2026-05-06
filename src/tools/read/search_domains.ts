import { z } from "zod";
import { checkDomainsBatch } from "../../cloudflare/registrar.js";
import { listZones } from "../../cloudflare/zones.js";
import { getPorkbunPricing } from "../../porkbun/pricing.js";
import { checkRDAPBatch, RDAP_SUPPORTED_TLDS } from "../../rdap/client.js";
import { textContent } from "../../types.js";

export const name = "search_domains";
export const description =
    "Search for available domain names across multiple keywords and TLDs. Uses RDAP (authoritative registry data) for availability where supported, Cloudflare Registrar for pricing. For TLDs without RDAP (.io, .co, .me etc.) uses CF availability signal with a warning. Pass multiple keywords to check all at once.";

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

    // RDAP batch check for domains where CF says available or premium,
    // limited to TLDs with RDAP coverage. 150ms delay between requests.
    const rdapCandidates = toCheck.filter((d) => {
        const tld = d.split(".").slice(-1)[0];
        if (!RDAP_SUPPORTED_TLDS.has(tld)) return false;
        const r = cfMap.get(d);
        if (!r) return false;
        // Check all CF-available, CF-premium, and CF-unsupported-API domains
        return r.registrable || r.reason === "domain_premium" || r.reason === "extension_not_supported_via_api";
    });
    const rdapResults = await checkRDAPBatch(rdapCandidates);

    type RowResult = {
        domain: string;
        available: boolean | null;      // null = unknown
        availableSource: string;        // "RDAP" | "CF" | "CF(unverified)" | "CF(no-RDAP)" | "unknown"
        owned: boolean;
        cfPrice?: string;
        pbPrice?: string;
        takenBy?: string;               // registrar from RDAP if taken
        note?: string;
    };
    const results: RowResult[] = allDomains.map((domain) => {
        if (ownedZones.has(domain)) return { domain, available: false, availableSource: "owned", owned: true };

        const r = cfMap.get(domain);
        const tld = domain.split(".").slice(-1)[0];
        const pb = pbPricing.get(tld);
        const rdap = rdapResults.get(domain);
        const hasRdap = RDAP_SUPPORTED_TLDS.has(tld);

        let available: boolean | null = null;
        let availableSource = "unknown";
        let cfPrice: string | undefined;
        let pbPrice: string | undefined;
        let takenBy: string | undefined;
        let note: string | undefined;

        if (pb) pbPrice = `$${pb.registration}`;

        if (r?.pricing) cfPrice = `$${r.pricing.registration_cost}`;

        // RDAP is authoritative for supported TLDs
        if (rdap !== undefined) {
            available = !rdap.registered;
            availableSource = "RDAP";
            if (rdap.registered) takenBy = rdap.registrar;
        } else if (r?.reason === "domain_unavailable") {
            available = false;
            availableSource = "CF";
        } else if (r?.registrable) {
            available = true;
            availableSource = hasRdap ? "CF(RDAP-err)" : "CF(no-RDAP)";
            if (!hasRdap) note = "unverified";
        } else if (r?.reason === "domain_premium") {
            // CF says premium — but RDAP doesn't cover this TLD (or RDAP lookup wasn't attempted).
            // Premium domains are almost always registered. Treat as unknown but flag it.
            available = null;
            availableSource = "CF";
            note = "premium — verify manually";
            if (r.pricing) cfPrice = `$${r.pricing.registration_cost}*`;
        } else if (r?.reason === "extension_not_supported_via_api") {
            available = null;
            availableSource = "CF";
            note = "CF API unsupported TLD";
        } else if (r?.reason === "extension_not_supported") {
            available = null;
            availableSource = "CF";
            note = "TLD not in CF";
        }

        return { domain, available, availableSource, owned: false, cfPrice, pbPrice, takenBy, note };
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
            const avail = kwResults.filter((r) => r.available === true && !r.owned).length;
            lines.push(`### "${kw}" — ${avail} available`);
        }

        lines.push(`${"Domain".padEnd(25)} ${"Status".padEnd(20)} ${"CF Price".padEnd(13)} ${"PB Ref Price"}`);
        lines.push(`${"-".repeat(80)}`);

        for (const r of kwResults) {
            if (args.available_only && !r.owned && r.available !== true) continue;

            let status: string;
            if (r.owned) {
                status = "yours ✅";
            } else if (r.available === true) {
                const suffix = r.availableSource === "CF(no-RDAP)" ? " ⚠️" : "";
                status = `available ✅${suffix}`;
            } else if (r.available === false) {
                status = r.takenBy ? `taken ❌ (${r.takenBy.split(" ")[0]})` : "taken ❌";
            } else {
                // null = unknown
                status = r.note ? `? (${r.note})` : "unknown ❓";
            }

            // Truncate long status for table alignment
            if (status.length > 18) status = status.substring(0, 17) + "…";

            const cfPrice = r.cfPrice ?? "-";
            const pbPrice = r.pbPrice ?? "-";

            lines.push(
                `${r.domain.padEnd(25)} ${status.padEnd(20)} ${cfPrice.padEnd(13)} ${pbPrice}`,
            );
        }
        lines.push("");
    }

    const totalAvailable = results.filter((r) => r.available === true && !r.owned);
    const rdapVerified = results.filter(
        (r) => r.available === true && r.availableSource === "RDAP",
    );
    const unverified = results.filter(
        (r) => r.available === true && r.availableSource !== "RDAP",
    );

    lines.push(
        `**Summary:** ${totalAvailable.length}/${results.length} available` +
        (rdapVerified.length ? ` (${rdapVerified.length} RDAP-verified` : "") +
        (unverified.length ? `, ${unverified.length} unverified` : "") +
        (rdapVerified.length ? ")" : ""),
    );

    const cfRegistrable = results.filter(
        (r) => r.available === true && !r.owned && cfMap.get(r.domain)?.registrable,
    );
    if (cfRegistrable.length > 0) {
        lines.push(`\nCF registrable: \`register_domain({ domain: "${cfRegistrable[0].domain}" })\``);
    }

    const noRdapTlds = [...new Set(tlds.filter((t) => !RDAP_SUPPORTED_TLDS.has(t)))];
    if (noRdapTlds.length > 0) {
        lines.push(`\n*⚠️  No RDAP for: .${noRdapTlds.join(", .")} — availability unverified for those TLDs. Use check_domain() for a deeper check.*`);
    }

    return textContent(lines.join("\n"));
}
