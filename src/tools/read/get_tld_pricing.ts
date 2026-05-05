import { z } from "zod";
import { getTLDPolicies } from "../../cloudflare/registrar.js";
import { textContent } from "../../types.js";

export const name = "get_tld_pricing";
export const description =
    "Get Cloudflare Registrar pricing and availability for TLDs. Shows registration, renewal, and transfer fees. Use this before registering a domain to confirm pricing.";

export const inputSchema = z.object({
    tlds: z
        .array(z.string().min(2).max(24))
        .min(1)
        .max(50)
        .default(["com", "net", "org", "io", "co", "app", "dev", "ai", "xyz", "me"])
        .describe("TLDs to get pricing for (without dot), e.g. ['com', 'io', 'app']"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const tlds = args.tlds.map((t) => t.toLowerCase().replace(/^\./, ""));
    const policies = await getTLDPolicies(tlds);

    if (policies.length === 0) {
        return textContent("No pricing information found for the requested TLDs.");
    }

    const lines: string[] = [
        `## Cloudflare Registrar Pricing\n`,
        `${"TLD".padEnd(12)} ${"Supported".padEnd(10)} ${"Register".padEnd(12)} ${"Renew".padEnd(10)} ${"Transfer".padEnd(10)} Privacy`,
        "-".repeat(70),
    ];

    // Show requested TLDs in order (even if not found)
    const policyMap = new Map(policies.map((p) => [p.tld.toLowerCase(), p]));
    for (const tld of tlds) {
        const p = policyMap.get(tld);
        if (!p) {
            lines.push(`${"." + tld.padEnd(11)} ${"N/A".padEnd(10)} -`);
            continue;
        }
        const supported = p.supported ? "✅ yes" : "❌ no";
        const privacy = p.privacy_supported ? "yes" : "no";
        const reg = p.supported ? `$${p.registration_fee}` : "-";
        const renew = p.supported ? `$${p.renewal_fee}` : "-";
        const transfer = p.supported ? `$${p.transfer_fee}` : "-";
        lines.push(
            `${"." + p.tld.padEnd(11)} ${supported.padEnd(10)} ${reg.padEnd(12)} ${renew.padEnd(10)} ${transfer.padEnd(10)} ${privacy}`,
        );
    }

    const supportedCount = policies.filter((p) => p.supported).length;
    lines.push(`\n${supportedCount}/${tlds.length} TLDs supported by Cloudflare Registrar`);

    return textContent(lines.join("\n"));
}
