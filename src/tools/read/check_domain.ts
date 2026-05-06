import { z } from "zod";
import { getZoneByName } from "../../cloudflare/zones.js";
import { getRegistrarDomain, checkDomainsBatch } from "../../cloudflare/registrar.js";
import { textContent } from "../../types.js";

export const name = "check_domain";
export const description =
    "Check a domain's availability and status. Returns: whether it's registered with your Cloudflare account, active as a CF zone, or available for registration. Uses Cloudflare's authoritative real-time registry API — works for all TLDs (.io, .co, .me, .site, .tech, etc). Also shows pricing when available.";

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
        return textContent(lines.join("\n"));
    }

    // 3. Check availability via CF Registrar (authoritative, real-time)
    const [result] = await checkDomainsBatch([domain]);
    if (!result) {
        lines.push("**Status:** Unknown ❓");
        lines.push("CF Registrar returned no data for this domain.");
        return textContent(lines.join("\n"));
    }

    if (result.registrable) {
        lines.push("**Status:** Available for registration ✅");
        if (result.pricing) {
            lines.push(`**CF Registration:** $${result.pricing.registration_cost} ${result.pricing.currency}/yr`);
            lines.push(`**CF Renewal:** $${result.pricing.renewal_cost} ${result.pricing.currency}/yr`);
        }
        if (result.tier === "premium") lines.push("**Note:** Premium domain");
        lines.push(`\nTo register: \`register_domain({ domain: "${domain}" })\``);
    } else if (result.reason === "domain_unavailable") {
        lines.push("**Status:** Registered (taken) ❌");
        lines.push("\n*Not in your Cloudflare account. To manage it, transfer or add it as a zone.*");
    } else if (result.reason === "extension_not_supported_via_api") {
        lines.push("**Status:** TLD available via Cloudflare dashboard (not API) ⚠️");
        lines.push("*This TLD can be registered through the CF Registrar web UI but not programmatically.*");
    } else if (result.reason === "extension_not_supported") {
        lines.push("**Status:** TLD not supported by Cloudflare Registrar ⚠️");
        lines.push("*Check porkbun.com or namecheap.com to register this TLD.*");
    } else if (result.reason === "domain_premium") {
        lines.push("**Status:** Available (premium domain) ✅");
        if (result.pricing) {
            lines.push(`**CF Registration:** $${result.pricing.registration_cost} ${result.pricing.currency}/yr`);
            lines.push(`**CF Renewal:** $${result.pricing.renewal_cost} ${result.pricing.currency}/yr`);
        }
        lines.push(`\nTo register: \`register_domain({ domain: "${domain}" })\``);
    } else {
        lines.push("**Status:** Unknown ❓");
        if (result.reason) lines.push(`**Reason:** ${result.reason}`);
    }

    return textContent(lines.join("\n"));
}
