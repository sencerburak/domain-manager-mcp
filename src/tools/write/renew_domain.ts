import { z } from "zod";
import { renewDomain, getRegistrarDomain, checkDomainsBatch } from "../../cloudflare/registrar.js";
import { textContent, errorContent } from "../../types.js";

export const name = "renew_domain";
export const description =
    "Renew a domain registered with Cloudflare Registrar. WRITE OPERATION — will charge your Cloudflare account. Check current status with get_domain first.";

export const inputSchema = z.object({
    domain: z.string().describe("Domain to renew, e.g. 'example.com'"),
    years: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(1)
        .describe("Years to renew for (1–10)"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase().replace(/\.$/, "");

    // Pre-check: verify domain exists in CF registrar
    const current = await getRegistrarDomain(domain);
    if (!current) {
        return errorContent(
            `Domain "${domain}" is not registered with Cloudflare Registrar. ` +
            `Only CF Registrar domains can be renewed via this tool.`,
        );
    }

    // Pricing info for confirmation context — use the domain's renewal cost from registrar record
    let priceLine = "";
    try {
        if (current.fees?.renewal_fee) {
            const cost = (parseFloat(current.fees.renewal_fee) * args.years).toFixed(2);
            priceLine = `\n**Charge:** $${cost} ($${current.fees.renewal_fee}/yr × ${args.years} year${args.years > 1 ? "s" : ""})`;
        }
    } catch {
        /* non-fatal */
    }

    try {
        const result = await renewDomain(domain, args.years);

        const oldExpiry = current.expires_at?.slice(0, 10) ?? "unknown";
        const newExpiry = result.expires_at?.slice(0, 10) ?? "unknown";

        return textContent(
            [
                `## Domain Renewed: ${domain} ✅`,
                priceLine,
                `**Previous expiry:** ${oldExpiry}`,
                `**New expiry:** ${newExpiry}`,
                `**Auto-renew:** ${result.auto_renew ? "enabled" : "disabled"}`,
            ]
                .filter(Boolean)
                .join("\n"),
        );
    } catch (e) {
        return errorContent(
            `Failed to renew ${domain}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}
