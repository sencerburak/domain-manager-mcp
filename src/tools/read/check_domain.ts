import { z } from "zod";
import { getZoneByName } from "../../cloudflare/zones.js";
import { getRegistrarDomain, checkDomainsBatch } from "../../cloudflare/registrar.js";
import { getPorkbunPricing } from "../../porkbun/pricing.js";
import { checkPorkbunDomain } from "../../porkbun/availability.js";
import { checkRDAP, RDAP_SUPPORTED_TLDS } from "../../rdap/client.js";
import { textContent } from "../../types.js";

export const name = "check_domain";
export const description =
    "Check a domain's availability and pricing. Uses RDAP (authoritative registry data) as primary availability source, Cloudflare Registrar for pricing, and Porkbun as fallback for TLDs without RDAP. Shows: CF account ownership, active CF zones, definitive availability, and pricing comparison.";

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
                `**Renewal fee:** $${registrarDomain.fees.renewal_fee}/yr` +
                ` | Transfer: $${registrarDomain.fees.transfer_fee}`,
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

    // 3. Gather data in parallel: RDAP (authoritative), CF domain-check (pricing), Porkbun (pricing/fallback)
    const [rdapResult, [cfResult], pbPricingMap, pbAvailability] = await Promise.all([
        checkRDAP(apex),
        checkDomainsBatch([apex]),
        getPorkbunPricing([tld]),
        checkPorkbunDomain(apex),
    ]);

    const pbPrice = pbPricingMap.get(tld);
    const hasRdapSupport = RDAP_SUPPORTED_TLDS.has(tld);

    // 4. Determine availability — RDAP is authoritative where supported
    let available = false;
    let statusLine = "";
    let availabilitySource = "";

    if (rdapResult !== null) {
        // RDAP gave a definitive answer
        if (rdapResult.registered) {
            available = false;
            const parts = ["Registered (taken) ❌"];
            if (rdapResult.registrar) parts.push(`registered with ${rdapResult.registrar}`);
            if (rdapResult.expiresAt) parts.push(`expires ${rdapResult.expiresAt.split("T")[0]}`);
            statusLine = parts.join(" — ");
            availabilitySource = "RDAP";
        } else {
            available = true;
            statusLine = "Available for registration ✅";
            availabilitySource = "RDAP";
        }
    } else if (cfResult?.reason === "domain_unavailable") {
        available = false;
        statusLine = "Registered (taken) ❌";
        availabilitySource = "Cloudflare";
    } else if (cfResult?.registrable) {
        // CF says available — no RDAP to verify. Porkbun as cross-check.
        if (pbAvailability !== null) {
            if (pbAvailability.available) {
                available = true;
                statusLine = "Available for registration ✅";
                availabilitySource = "Cloudflare + Porkbun";
            } else {
                available = false;
                statusLine = "Registered (taken) ❌ — CF/Porkbun mismatch, likely taken";
                availabilitySource = "Porkbun";
            }
        } else {
            available = true;
            statusLine = `Available for registration ✅ (no RDAP for .${tld} — unverified)`;
            availabilitySource = "Cloudflare";
        }
    } else if (cfResult?.reason === "domain_premium") {
        // CF thinks it's premium — could be taken at a premium price OR a genuine premium name.
        // RDAP returned null (no coverage for this TLD) so we can't verify.
        if (pbAvailability !== null) {
            if (pbAvailability.available) {
                available = true;
                statusLine = "Available (premium) 💎";
                availabilitySource = "Porkbun";
            } else {
                available = false;
                statusLine = "Registered (taken) ❌";
                availabilitySource = "Porkbun";
            }
        } else {
            available = false; // Assume taken — premium domains almost always are
            statusLine = "Premium domain — likely registered, verify manually ⚠️";
            availabilitySource = "CF (unverified)";
        }
    } else if (
        cfResult?.reason === "extension_not_supported_via_api" ||
        cfResult?.reason === "extension_not_supported"
    ) {
        if (pbAvailability !== null) {
            if (pbAvailability.available) {
                available = true;
                statusLine = pbAvailability.premium
                    ? "Available (premium) 💎"
                    : "Available for registration ✅";
                availabilitySource = "Porkbun";
            } else {
                available = false;
                statusLine = "Registered (taken) ❌";
                availabilitySource = "Porkbun";
            }
        } else {
            statusLine = `TLD not fully supported by CF${hasRdapSupport ? " (RDAP lookup failed)" : ""} ⚠️`;
            availabilitySource = "unknown";
        }
    } else {
        statusLine = "Unknown ❓ — no data from RDAP, CF, or Porkbun";
        availabilitySource = "none";
    }

    lines.push(`**Status:** ${statusLine}`);
    if (availabilitySource && availabilitySource !== "none") {
        lines.push(`**Source:** ${availabilitySource}`);
    }
    lines.push("");

    // 5. Pricing table
    lines.push("### Pricing");
    lines.push(`${"Registrar".padEnd(20)} ${"Registration".padEnd(15)} ${"Renewal".padEnd(15)} ${"Availability"}`);
    lines.push(`${"-".repeat(75)}`);

    const cfReg = cfResult?.pricing ? `$${cfResult.pricing.registration_cost}` : "—";
    const cfRenew = cfResult?.pricing ? `$${cfResult.pricing.renewal_cost}` : "—";

    let cfAvailDisplay: string;
    if (cfResult?.registrable) cfAvailDisplay = "✅ Available";
    else if (cfResult?.reason === "domain_unavailable") cfAvailDisplay = "❌ Taken";
    else if (cfResult?.reason === "domain_premium") cfAvailDisplay = "💎 Premium";
    else if (cfResult?.reason?.includes("extension_not_supported")) cfAvailDisplay = "⚠️  Not in CF";
    else cfAvailDisplay = "—";

    lines.push(`${"Cloudflare".padEnd(20)} ${cfReg.padEnd(15)} ${cfRenew.padEnd(15)} ${cfAvailDisplay}`);

    if (pbAvailability) {
        const pbReg = pbAvailability.registration
            ? `$${pbAvailability.registration}`
            : pbPrice
                ? `$${pbPrice.registration}`
                : "—";
        const pbRenew = pbAvailability.renewal
            ? `$${pbAvailability.renewal}`
            : pbPrice
                ? `$${pbPrice.renewal}`
                : "—";
        const pbAvailDisplay = pbAvailability.available
            ? pbAvailability.premium ? "💎 Available (premium)" : "✅ Available"
            : "❌ Taken";
        lines.push(`${"Porkbun".padEnd(20)} ${pbReg.padEnd(15)} ${pbRenew.padEnd(15)} ${pbAvailDisplay}`);
    } else if (pbPrice) {
        lines.push(
            `${"Porkbun (ref)".padEnd(20)} $${pbPrice.registration.padEnd(14)} $${pbPrice.renewal.padEnd(14)} (pricing only)`,
        );
    }

    if (rdapResult?.registered && rdapResult.registrar) {
        lines.push("");
        lines.push(`**Registrar:** ${rdapResult.registrar}`);
        if (rdapResult.expiresAt) lines.push(`**Expires:** ${rdapResult.expiresAt.split("T")[0]}`);
    }

    if (available && cfResult?.registrable) {
        lines.push(`\n**To register via CF:** \`register_domain({ domain: "${domain}" })\``);
    } else if (available && !cfResult?.registrable) {
        lines.push(`\n**Available via Porkbun** — register at https://porkbun.com`);
    }

    return textContent(lines.join("\n"));
}
