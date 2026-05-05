import { z } from "zod";
import { getZoneByName } from "../../cloudflare/zones.js";
import { getRegistrarDomain, checkAvailabilityRDAP, getTLDPolicies } from "../../cloudflare/registrar.js";
import { textContent } from "../../types.js";

export const name = "check_domain";
export const description =
    "Check a domain's availability and status. Returns: whether it's registered with your Cloudflare account, active as a CF zone, or available for registration (via public RDAP lookup). Also shows pricing if available on Cloudflare Registrar.";

export const inputSchema = z.object({
    domain: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)+$/)
        .describe("Fully-qualified domain name, e.g. 'example.com' or 'sub.example.com'"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase();
    const apex = domain.split(".").slice(-2).join(".");

    const lines: string[] = [`## Domain: ${domain}\n`];

    // 1. Check CF registrar (user owns it via CF)
    const registrarDomain = await getRegistrarDomain(apex);
    if (registrarDomain) {
        lines.push("**Status:** Registered with Cloudflare Registrar ✅");
        lines.push(`**Expires:** ${registrarDomain.expires_at ?? "unknown"}`);
        lines.push(`**Auto-renew:** ${registrarDomain.auto_renew ? "yes" : "no"}`);
        lines.push(`**Lock:** ${registrarDomain.locked ? "locked" : "unlocked"}`);
        lines.push(`**Privacy:** ${registrarDomain.privacy ? "enabled" : "disabled"}`);
        if (registrarDomain.name_servers?.length) {
            lines.push(`**Nameservers:** ${registrarDomain.name_servers.join(", ")}`);
        }
        if (registrarDomain.fees) {
            lines.push(
                `**Renewal fee:** $${registrarDomain.fees.renewal_fee}/yr  ` +
                `| Transfer: $${registrarDomain.fees.transfer_fee}`,
            );
        }
        return textContent(lines.join("\n"));
    }

    // 2. Check CF zones (active zone, possibly registered elsewhere)
    const zone = await getZoneByName(apex);
    if (zone) {
        lines.push(`**Status:** Active Cloudflare zone (registered elsewhere) ℹ️`);
        lines.push(`**Zone status:** ${zone.status}`);
        lines.push(`**Plan:** ${zone.plan.name}`);
        lines.push(`**Nameservers:** ${zone.name_servers.join(", ")}`);

        // Try to get pricing anyway
        try {
            const tld = apex.split(".").slice(1).join(".");
            const policies = await getTLDPolicies([tld]);
            if (policies.length > 0) {
                lines.push(
                    `**Transfer to CF:** $${policies[0].transfer_fee}  ` +
                    `| Renewal at CF: $${policies[0].renewal_fee}/yr`,
                );
            }
        } catch {
            /* pricing optional */
        }
        return textContent(lines.join("\n"));
    }

    // 3. Check RDAP for availability
    const rdap = await checkAvailabilityRDAP(domain);
    if (rdap.registered) {
        lines.push("**Status:** Registered (taken) ❌");
        if (rdap.registrar) lines.push(`**Registrar:** ${rdap.registrar}`);
        if (rdap.expires) lines.push(`**Expires:** ${rdap.expires}`);
        if (rdap.created) lines.push(`**Registered:** ${rdap.created}`);
        lines.push("\n*Not in your Cloudflare account. To manage it, transfer or add it as a zone.*");
    } else {
        lines.push("**Status:** Available for registration ✅");

        // Show CF pricing if we support this TLD
        try {
            const tld = domain.split(".").slice(1).join(".");
            const policies = await getTLDPolicies([tld]);
            if (policies.length > 0 && policies[0].supported) {
                const p = policies[0];
                lines.push(`**CF Registration:** $${p.registration_fee}/yr`);
                lines.push(`**CF Renewal:** $${p.renewal_fee}/yr`);
                lines.push(
                    `\nTo register: \`register_domain({ domain: "${domain}" })\``,
                );
            } else {
                lines.push("*TLD not supported by Cloudflare Registrar. Check porkbun.com or namecheap.com.*");
            }
        } catch {
            /* pricing optional */
        }
    }

    return textContent(lines.join("\n"));
}
