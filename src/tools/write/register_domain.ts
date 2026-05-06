import { z } from "zod";
import { registerDomain, getTLDPolicies } from "../../cloudflare/registrar.js";
import { textContent, errorContent } from "../../types.js";

export const name = "register_domain";
export const description =
    "Register a new domain through Cloudflare Registrar. WRITE OPERATION — will charge your Cloudflare account. Check pricing first with get_tld_pricing. The domain must be available (verify with check_domain first).";

export const inputSchema = z.object({
    domain: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z]{2,})$/)
        .describe("Domain to register, e.g. 'myapp.com'"),
    auto_renew: z
        .boolean()
        .default(true)
        .describe("Automatically renew before expiry (recommended)"),
    privacy: z
        .boolean()
        .default(false)
        .describe("Enable WHOIS privacy protection (hides contact info)"),
    years: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(1)
        .describe("Years to register for (1–10)"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase();
    console.log(`[Tool] register_domain called with domain="${domain}"`);

    // Look up pricing before registering (gives context to user in confirmation)
    let priceLine = "";
    try {
        const tld = domain.split(".").slice(1).join(".");
        const policies = await getTLDPolicies([tld]);
        if (policies.length > 0 && policies[0].supported) {
            const p = policies[0];
            const cost = (parseFloat(p.registration_fee) * args.years).toFixed(2);
            priceLine = `\n**Charge:** $${cost} ($${p.registration_fee}/yr × ${args.years} year${args.years > 1 ? "s" : ""})`;
        }
    } catch (err) {
        console.log(`[Tool] Non-fatal error getting TLD policies:`, err instanceof Error ? err.message : String(err));
    }

    try {
        const result = await registerDomain(domain, {
            auto_renew: args.auto_renew,
            privacy: args.privacy,
            years: args.years,
        });

        console.log(`[Tool] register_domain succeeded`);
        return textContent(
            [
                `## Domain Registered: ${domain} ✅`,
                priceLine,
                `**Expires:** ${result.expires_at?.slice(0, 10) ?? "unknown"}`,
                `**Auto-renew:** ${result.auto_renew ? "enabled" : "disabled"}`,
                `**Privacy:** ${result.privacy ? "enabled" : "disabled"}`,
                `**Nameservers:** ${result.name_servers?.join(", ") ?? "pending"}`,
                `\nA Cloudflare zone for ${domain} should be created automatically.`,
                `To add DNS records: \`create_dns_record({ domain: "${domain}", ... })\``,
            ]
                .filter(Boolean)
                .join("\n"),
        );
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[Tool] register_domain failed: ${errMsg}`);
        console.error(`[Tool] Full error:`, e);
        return errorContent(`Failed to register ${domain}: ${errMsg}`);
    }
}
