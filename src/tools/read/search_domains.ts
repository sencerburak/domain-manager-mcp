import { z } from "zod";
import { checkDomainsBatch } from "../../cloudflare/registrar.js";
import { listZones } from "../../cloudflare/zones.js";
import { textContent } from "../../types.js";

export const name = "search_domains";
export const description =
    "Search for available domain names for one or more keywords across multiple TLDs. Uses Cloudflare's authoritative real-time registry check — works for all TLDs (.io, .co, .me, .site, .tech, etc). Pass multiple keywords to check all at once instead of calling this tool repeatedly.";

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

    // Build full matrix and separate owned from those needing check
    const allDomains = keywords.flatMap((kw) => tlds.map((tld) => `${kw}.${tld}`));
    const toCheck = allDomains.filter((d) => !ownedZones.has(d));

    // CF batch check — up to 20 per request, chunked automatically
    const cfResults = await checkDomainsBatch(toCheck);
    const cfMap = new Map(cfResults.map((r) => [r.name, r]));

    type RowResult = { domain: string; available: boolean | null; owned: boolean; price?: string; reason?: string };
    const results: RowResult[] = allDomains.map((domain) => {
        if (ownedZones.has(domain)) return { domain, available: false, owned: true };
        const r = cfMap.get(domain);
        if (!r) return { domain, available: null, owned: false };
        if (r.registrable) {
            const price = r.pricing ? `$${r.pricing.registration_cost} ${r.pricing.currency}` : undefined;
            return { domain, available: true, owned: false, price };
        }
        const available = r.reason === "extension_not_supported_via_api" ? null
            : r.reason === "extension_not_supported" ? null
            : r.reason === "domain_premium" ? true
            : false;
        const reason = r.reason === "extension_not_supported_via_api" ? "use CF dashboard"
            : r.reason === "extension_not_supported" ? "TLD not in CF Registrar"
            : r.reason === "domain_premium" ? "premium domain"
            : undefined;
        return { domain, available, owned: false, reason };
    });

    const lines: string[] = [
        `## Domain Search: ${keywords.map((k) => `"${k}"`).join(", ")}`,
        `Checked ${results.length} combinations (${keywords.length} keyword(s) × ${tlds.length} TLD(s))\n`,
    ];

    const grouped = keywords.length > 1;
    for (const kw of keywords) {
        const kwResults = results.filter((r) => r.domain.startsWith(`${kw}.`));
        if (grouped) {
            const avail = kwResults.filter((r) => r.available === true && !r.owned).length;
            lines.push(`### "${kw}" — ${avail} available`);
        }

        lines.push(`${"Domain".padEnd(35)} ${"Status".padEnd(18)} ${"Price"}`);
        lines.push(`${"-".repeat(65)}`);

        for (const r of kwResults) {
            if (args.available_only && r.available !== true && !r.owned) continue;
            const status = r.owned ? "yours ✅"
                : r.available === true ? "available ✅"
                : r.available === null ? `unknown ❓${r.reason ? ` (${r.reason})` : ""}`
                : "taken ❌";
            const price = r.owned ? "owned"
                : r.available === true && r.price ? r.price
                : r.available === true ? "premium"
                : "-";
            lines.push(`${r.domain.padEnd(35)} ${status.padEnd(18)} ${price}`);
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
