import { z } from "zod";
import { checkDomainsBatch } from "../../cloudflare/registrar.js";
import { textContent } from "../../types.js";

export const name = "get_tld_pricing";
export const description =
    "Get Cloudflare Registrar pricing for TLDs. Shows registration and renewal fees. Use this before registering a domain to confirm pricing.";

export const inputSchema = z.object({
    tlds: z
        .array(z.string().min(2).max(24))
        .min(1)
        .max(20)
        .default(["com", "net", "org", "app", "dev", "ai", "xyz", "me"])
        .describe("TLDs to get pricing for (without dot), e.g. ['com', 'io', 'app']"),
});

// Dummy name unlikely to be registered, used only to probe pricing
const DUMMY = "xyzpricingprobe98765";

export async function handler(args: z.infer<typeof inputSchema>) {
    const tlds = args.tlds.map((t) => t.toLowerCase().replace(/^\./, ""));

    // Use domain-check with a dummy domain name to get per-TLD pricing
    const domains = tlds.map((tld) => `${DUMMY}.${tld}`);
    const results = await checkDomainsBatch(domains);

    const lines: string[] = [
        `## Cloudflare Registrar Pricing\n`,
        `${"TLD".padEnd(12)} ${"Supported".padEnd(12)} ${"Register".padEnd(12)} ${"Renew".padEnd(10)}`,
        "-".repeat(50),
    ];

    const resultMap = new Map(results.map((r) => [r.name.replace(`${DUMMY}.`, ""), r]));
    for (const tld of tlds) {
        const r = resultMap.get(tld);
        if (!r) {
            lines.push(`${"." + tld.padEnd(11)} ${"unknown".padEnd(12)} -`);
            continue;
        }
        if (r.registrable && r.pricing) {
            const reg = `$${r.pricing.registration_cost}`;
            const renew = `$${r.pricing.renewal_cost}`;
            const note = r.tier === "premium" ? " (premium)" : "";
            lines.push(`${"." + tld.padEnd(11)} ${"✅ yes".padEnd(12)} ${reg.padEnd(12)} ${renew}${note}`);
        } else if (r.reason === "extension_not_supported_via_api") {
            lines.push(`${"." + tld.padEnd(11)} ${"⚠️ dashboard".padEnd(12)} register via CF web UI`);
        } else if (r.reason === "extension_not_supported") {
            lines.push(`${"." + tld.padEnd(11)} ${"❌ no".padEnd(12)} -`);
        } else if (r.reason === "domain_unavailable") {
            // dummy name was taken — try different dummy or report as unknown pricing
            lines.push(`${"." + tld.padEnd(11)} ${"✅ yes".padEnd(12)} pricing unavailable (retry)`);
        } else {
            lines.push(`${"." + tld.padEnd(11)} ${"❓ unknown".padEnd(12)} -`);
        }
    }

    const supported = results.filter((r) => r.registrable || r.reason === "extension_not_supported_via_api").length;
    lines.push(`\n*${supported}/${tlds.length} TLDs supported via Cloudflare Registrar*`);

    return textContent(lines.join("\n"));
}
