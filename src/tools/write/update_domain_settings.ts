import { z } from "zod";
import { updateDomainSettings, getRegistrarDomain } from "../../cloudflare/registrar.js";
import { textContent, errorContent } from "../../types.js";

export const name = "update_domain_settings";
export const description =
    "Update Cloudflare Registrar settings for a domain: auto-renew, transfer lock, and WHOIS privacy. WRITE OPERATION. Only applies to domains registered with CF Registrar.";

export const inputSchema = z.object({
    domain: z.string().describe("Domain to update, e.g. 'example.com'"),
    auto_renew: z
        .boolean()
        .optional()
        .describe("Enable or disable automatic renewal"),
    locked: z
        .boolean()
        .optional()
        .describe("Lock (true) or unlock (false) the domain to prevent transfers"),
    privacy: z
        .boolean()
        .optional()
        .describe("Enable or disable WHOIS privacy protection"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase().replace(/\.$/, "");
    if (args.auto_renew === undefined && args.locked === undefined && args.privacy === undefined) {
        return errorContent("At least one setting (auto_renew, locked, or privacy) must be provided.");
    }
    // Verify domain is in CF registrar
    const current = await getRegistrarDomain(domain);
    if (!current) {
        return errorContent(
            `Domain "${domain}" is not registered with Cloudflare Registrar. ` +
            `Settings can only be updated for CF Registrar domains.`,
        );
    }

    const updates: { auto_renew?: boolean; locked?: boolean; privacy?: boolean } = {};
    if (args.auto_renew !== undefined) updates.auto_renew = args.auto_renew;
    if (args.locked !== undefined) updates.locked = args.locked;
    if (args.privacy !== undefined) updates.privacy = args.privacy;

    try {
        const result = await updateDomainSettings(domain, updates);

        const changed = Object.entries(updates)
            .map(([k, v]) => `- **${k}:** ${v ? "enabled" : "disabled"}`)
            .join("\n");

        return textContent(
            [
                `## Settings Updated: ${domain} ✅`,
                "",
                "**Changed:**",
                changed,
                "",
                "**Current state:**",
                `- Auto-renew: ${result.auto_renew ? "✅ enabled" : "❌ disabled"}`,
                `- Locked: ${result.locked ? "yes" : "no"}`,
                `- Privacy: ${result.privacy ? "yes" : "no"}`,
                `- Expires: ${result.expires_at?.slice(0, 10) ?? "unknown"}`,
            ].join("\n"),
        );
    } catch (e) {
        return errorContent(
            `Failed to update settings for ${domain}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}
