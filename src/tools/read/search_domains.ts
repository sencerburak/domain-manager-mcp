import { z } from "zod";
import { checkAvailabilityRDAP, getTLDPolicies } from "../../cloudflare/registrar.js";
import { listZones } from "../../cloudflare/zones.js";
import { textContent } from "../../types.js";

export const name = "search_domains";
export const description =
    "Search for available domain names for a keyword across multiple TLDs. Checks RDAP for availability and Cloudflare Registrar for pricing. Rate-limited to ~2 checks/sec to be respectful.";

export const inputSchema = z.object({
    keyword: z
        .string()
        .min(1)
        .max(63)
        .describe("Keyword or brand name to search (without TLD), e.g. 'myapp' or 'acme'"),
    tlds: z
        .array(z.string().regex(/^[a-z]{2,}$/i))
        .min(1)
        .max(15)
        .default(["com", "net", "org", "io", "co", "app", "dev", "ai", "xyz", "me"])
        .describe("TLDs to check. Defaults to 10 popular ones. Max 15."),
    available_only: z.boolean().default(false).describe("Only show available domains"),
});

const DELAY_MS = 500; // Respectful RDAP rate limiting

export async function handler(args: z.infer<typeof inputSchema>) {
    const keyword = args.keyword.toLowerCase().trim();
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

    const lines: string[] = [
        `## Domain Search: "${keyword}"`,
        `Checking ${tlds.length} TLDs...\n`,
        `${"Domain".padEnd(35)} ${"Status".padEnd(12)} ${"CF Price"}`,
        `${"-".repeat(65)}`,
    ];

    const results: { domain: string; available: boolean; owned: boolean; price?: string }[] = [];

    for (let i = 0; i < tlds.length; i++) {
        const domain = `${keyword}.${tlds[i]}`;

        if (ownedZones.has(domain)) {
            results.push({ domain, available: false, owned: true });
        } else {
            if (i > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
            const rdap = await checkAvailabilityRDAP(domain);
            const price = pricingMap.get(tlds[i]);
            results.push({
                domain,
                available: !rdap.registered,
                owned: false,
                price,
            });
        }
    }

    for (const r of results) {
        if (args.available_only && !r.available && !r.owned) continue;

        const status = r.owned ? "yours ✅" : r.available ? "available ✅" : "taken ❌";
        const price = r.owned ? "owned" : r.available && r.price ? `$${r.price}/yr` : r.available ? "check CF" : "-";
        lines.push(`${r.domain.padEnd(35)} ${status.padEnd(12)} ${price}`);
    }

    const available = results.filter((r) => r.available && !r.owned);
    lines.push(`\n${available.length}/${tlds.length} domains available`);

    if (available.length > 0) {
        lines.push(
            `\nTo register: \`register_domain({ domain: "${available[0].domain}" })\``,
        );
    }

    return textContent(lines.join("\n"));
}
