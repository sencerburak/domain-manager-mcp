import { z } from "zod";
import { getZoneByName } from "../../cloudflare/zones.js";
import { getRegistrarDomain, checkDomainsBatch } from "../../cloudflare/registrar.js";
import { getPorkbunPricing } from "../../porkbun/pricing.js";
import { checkPorkbunDomain } from "../../porkbun/availability.js";
import { textContent } from "../../types.js";

export const name = "check_domain";
export const description =
    "Check a domain's availability and pricing via Cloudflare Registrar API. For TLDs not fully supported by CF, checks actual availability on Porkbun API (if PORKBUN_API_KEY/SECRET configured). Shows: CF account ownership, active CF zones, real-time availability from CF and/or Porkbun, and pricing comparison.";

export const inputSchema = z.object({
    domain: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)+$/)
        .describe("Fully-qualified domain name, e.g. 'example.com' or 'sub.example.com'"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase();
    const apex = domain.split(".").slice(-2).join(".");
    const tld = apex.split(".").slice(-1)[0];

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

    // 3. Check availability via CF and optionally Porkbun (if auth configured)
    const [cfResult] = await checkDomainsBatch([domain]);
    const pbPricing = await getPorkbunPricing([tld]);
    const pbPrice = pbPricing.get(tld);
    const pbAvailability = await checkPorkbunDomain(domain);

    // Determine status
    let status = "Unknown ❓";
    let cfAvailable = false;

    if (cfResult?.registrable) {
        status = "Available for registration ✅";
        cfAvailable = true;
    } else if (cfResult?.reason === "domain_unavailable") {
        status = "Registered (taken) ❌";
    } else if (cfResult?.reason === "extension_not_supported_via_api" || cfResult?.reason === "extension_not_supported") {
        status = "TLD not fully supported by CF API ⚠️";
    } else if (!cfResult) {
        status = "No CF data ⚠️";
    }

    lines.push(`**Status:** ${status}`);
    lines.push("");

    // Pricing comparison
    lines.push("### Pricing & Availability");
    lines.push(`${"Registrar".padEnd(20)} ${"Registration".padEnd(15)} ${"Renewal".padEnd(15)} ${"Availability"}`);
    lines.push(`${"-".repeat(75)}`);

    const cfReg = cfResult?.pricing ? `$${cfResult.pricing.registration_cost}` : "—";
    const cfRenew = cfResult?.pricing ? `$${cfResult.pricing.renewal_cost}` : "—";
    lines.push(`${"Cloudflare".padEnd(20)} ${cfReg.padEnd(15)} ${cfRenew.padEnd(15)} ${cfAvailable ? "✅ Available" : cfResult?.reason === "domain_unavailable" ? "❌ Taken" : "⚠️  Unknown API"}`);

    if (pbAvailability) {
        const pbReg = pbAvailability.registration ? `$${pbAvailability.registration}` : pbPrice ? `$${pbPrice.registration}` : "—";
        const pbRenew = pbAvailability.renewal ? `$${pbAvailability.renewal}` : pbPrice ? `$${pbPrice.renewal}` : "—";
        const pbStatus = pbAvailability.available ? (pbAvailability.premium ? "✅ Available (premium)" : "✅ Available") : "❌ Taken";
        lines.push(
            `${"Porkbun".padEnd(20)} ${pbReg.padEnd(15)} ${pbRenew.padEnd(15)} ${pbStatus}`,
        );
    } else if (pbPrice) {
        lines.push(
            `${"Porkbun (ref)".padEnd(20)} $${pbPrice.registration.padEnd(14)} $${pbPrice.renewal.padEnd(14)} (pricing only)`,
        );
    }

    lines.push("");

    // Status details
    if (cfResult?.reason === "domain_premium") {
        lines.push("**Note:** Premium domain — higher pricing applies");
    } else if (cfResult?.reason === "extension_not_supported_via_api") {
        lines.push("**Note:** CF supports this TLD via dashboard UI, but not via API");
        if (pbAvailability) {
            lines.push(pbAvailability.available ? `→ Porkbun shows as ${pbAvailability.premium ? "premium" : "standard"} available` : `→ Porkbun shows as taken`);
        }
    } else if (cfResult?.reason === "extension_not_supported") {
        lines.push("**Note:** CF Registrar doesn't support this TLD");
        if (pbAvailability) {
            lines.push(pbAvailability.available ? `→ Porkbun shows as available` : `→ Porkbun shows as taken`);
        }
    }

    if (cfAvailable) {
        lines.push(`\n**To register:** \`register_domain({ domain: "${domain}" })\``);
    } else if (pbAvailability?.available && !cfAvailable) {
        lines.push(`\n**Available via Porkbun** — register at https://porkbun.com`);
    }

    return textContent(lines.join("\n"));
}
