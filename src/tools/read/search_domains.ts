import { z } from "zod";
import { checkAvailabilityRDAP, getTLDPolicies } from "../../cloudflare/registrar.js";
import { listZones } from "../../cloudflare/zones.js";
import { textContent } from "../../types.js";

export const name = "search_domains";
export const description =
    "Search for available domain names for one or more keywords across multiple TLDs. Checks RDAP for availability and Cloudflare Registrar for pricing. Pass multiple keywords to check all at once instead of calling this tool repeatedly.";

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
    // Normalize: keywords can be string or array
    const keywords = (Array.isArray(args.keywords) ? args.keywords : [args.keywords])
        .map((k) => k.toLowerCase().trim());
    const tlds = args.tlds.map((t) => t.toLowerCase().replace(/^\./, ""));

    // Pre-fetch user's existing zones for instant "owned" status
    const ownedZones = new Set<string>();
    try {
        const zones = await listZones();
        zones.forEach((z) => ownedZones.add(z.name));
    } catch {
        /* non-fatal */
    }

    // Pre-fetch CF pricing for all requested TLDs
    const pricingMap = new Map<string, string>();
    try {
        const policies = await getTLDPolicies(tlds);
        for (const p of policies) {
            if (p.supported) pricingMap.set(p.tld, p.registration_fee);
        }
    } catch {
        /* non-fatal */
    }

    // Check all keyword × TLD combinations in parallel (max 10 concurrent)
    const allDomains = keywords.flatMap((kw) => tlds.map((tld) => `${kw}.${tld}`));

    const checkBatch = async (domains: string[]) => {
        const CONCURRENCY = 10;
        const results: { domain: string; available: boolean | null; owned: boolean; price?: string }[] = [];
        for (let i = 0; i < domains.length; i += CONCURRENCY) {
            const chunk = domains.slice(i, i + CONCURRENCY);
            const chunkResults = await Promise.all(chunk.map(async (domain) => {
                if (ownedZones.has(domain)) {
                    return { domain, available: false, owned: true };
                }
                const tld = domain.split(".").slice(1).join(".");
                const rdap = await checkAvailabilityRDAP(domain);
                const price = pricingMap.get(tld);
                return {
                    domain,
                    available: rdap.error ? null : !rdap.registered,
                    owned: false,
                    price,
                };
            }));
            results.push(...chunkResults);
        }
        return results;
    };

    const results = await checkBatch(allDomains);

    const lines: string[] = [
        `## Domain Search: ${keywords.map((k) => `"${k}"`).join(", ")}`,
        `Checked ${results.length} combinations (${keywords.length} keyword(s) × ${tlds.length} TLD(s))\n`,
    ];

    // Group by keyword if multiple keywords
    const grouped = keywords.length > 1;
    for (const kw of keywords) {
        const kwResults = results.filter((r) => r.domain.startsWith(`${kw}.`));
        if (grouped) {
            const avail = kwResults.filter((r) => r.available === true && !r.owned).length;
            lines.push(`### "${kw}" — ${avail} available`);
        }

        lines.push(`${"Domain".padEnd(35)} ${"Status".padEnd(15)} ${"CF Price"}`);
        lines.push(`${"-".repeat(65)}`);

        for (const r of kwResults) {
            if (args.available_only && r.available !== true && !r.owned) continue;
            const status = r.owned ? "yours ✅" : r.available === true ? "available ✅" : r.available === null ? "unknown ❓" : "taken ❌";
            const price = r.owned ? "owned" : r.available === true && r.price ? `$${r.price}/yr` : r.available === true ? "check CF" : "-";
            lines.push(`${r.domain.padEnd(35)} ${status.padEnd(15)} ${price}`);
        }
        lines.push("");
    }

    const available = results.filter((r) => r.available === true && !r.owned);
    lines.push(`**Summary:** ${available.length}/${results.length} available`);

    if (available.length > 0) {
        lines.push(`\nTo register: \`register_domain({ domain: "${available[0].domain}" })\``);
    }

    return textContent(lines.join("\n"));
}
