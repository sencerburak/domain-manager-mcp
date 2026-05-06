import { z } from "zod";
import { getZoneByName } from "../../cloudflare/zones.js";
import { getRegistrarDomain, checkDomainsBatch } from "../../cloudflare/registrar.js";
import { textContent } from "../../types.js";

export const name = "batch_check_domains";
export const description =
    "Batch-check availability of multiple domain names across multiple TLDs. Uses Cloudflare's authoritative real-time registry API — no RDAP, works for all TLDs (.io, .co, .me, .site, .tech, etc). Returns a matrix of results.";

export const inputSchema = z.object({
    names: z
        .string()
        .array()
        .min(1)
        .describe("List of domain name bases (without TLD), e.g. ['example', 'myapp', 'test']"),
    tlds: z
        .string()
        .array()
        .min(1)
        .describe("List of TLDs to check, e.g. ['com', 'io', 'dev']. Prefix with '.' or not, both work."),
});

type CheckResult = {
    domain: string;
    status: "owned" | "zone" | "available" | "taken" | "unknown" | "unsupported";
    notes?: string;
};

export async function handler(args: z.infer<typeof inputSchema>) {
    const { names } = args;
    const normalizedTlds = args.tlds.map((tld) => tld.replace(/^\./, "").toLowerCase());

    const results: CheckResult[] = [];

    // 1. Check CF registrar ownership and zones per domain
    const ownershipResults = new Map<string, CheckResult>();
    for (const name of names) {
        for (const tld of normalizedTlds) {
            const domain = `${name.toLowerCase()}.${tld}`;
            try {
                const registrarDomain = await getRegistrarDomain(domain);
                if (registrarDomain) {
                    ownershipResults.set(domain, {
                        domain,
                        status: "owned",
                        notes: `CF Registrar, expires ${registrarDomain.expires_at || "unknown"}`,
                    });
                    continue;
                }
                const zone = await getZoneByName(domain);
                if (zone) {
                    ownershipResults.set(domain, {
                        domain,
                        status: "zone",
                        notes: `Active CF zone (${zone.status})`,
                    });
                }
            } catch { /* non-fatal — will fall through to availability check */ }
        }
    }

    // 2. Batch-check availability for domains not already resolved
    const allDomains = names.flatMap((n) => normalizedTlds.map((t) => `${n.toLowerCase()}.${t}`));
    const toCheck = allDomains.filter((d) => !ownershipResults.has(d));
    const cfResults = await checkDomainsBatch(toCheck);
    const cfMap = new Map(cfResults.map((r) => [r.name, r]));

    // 3. Merge
    for (const domain of allDomains) {
        if (ownershipResults.has(domain)) {
            results.push(ownershipResults.get(domain)!);
            continue;
        }
        const r = cfMap.get(domain);
        if (!r) {
            results.push({ domain, status: "unknown", notes: "No response from CF" });
            continue;
        }
        if (r.registrable) {
            const price = r.pricing ? ` — $${r.pricing.registration_cost} ${r.pricing.currency}/yr` : "";
            results.push({ domain, status: "available", notes: price.trim() || undefined });
        } else if (r.reason === "domain_unavailable") {
            results.push({ domain, status: "taken" });
        } else if (r.reason === "extension_not_supported" || r.reason === "extension_not_supported_via_api") {
            results.push({ domain, status: "unsupported", notes: r.reason === "extension_not_supported_via_api" ? "available via CF dashboard" : "TLD not in CF Registrar" });
        } else if (r.reason === "domain_premium") {
            const price = r.pricing ? ` — $${r.pricing.registration_cost} ${r.pricing.currency}/yr` : "";
            results.push({ domain, status: "available", notes: `premium${price}` });
        } else {
            results.push({ domain, status: "unknown", notes: r.reason });
        }
    }

    // 4. Format
    const byStatus = {
        owned: results.filter((r) => r.status === "owned"),
        zone: results.filter((r) => r.status === "zone"),
        available: results.filter((r) => r.status === "available"),
        taken: results.filter((r) => r.status === "taken"),
        unsupported: results.filter((r) => r.status === "unsupported"),
        unknown: results.filter((r) => r.status === "unknown"),
    };

    const lines: string[] = ["## Batch Domain Check Results\n"];
    lines.push(`Checked ${results.length} domain(s) across ${names.length} name(s) × ${normalizedTlds.length} TLD(s)\n`);

    if (byStatus.owned.length > 0) {
        lines.push("### ✅ Your Domains (Cloudflare Registrar)");
        for (const r of byStatus.owned) lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        lines.push("");
    }
    if (byStatus.zone.length > 0) {
        lines.push("### ℹ️ Active Zones (Registered elsewhere)");
        for (const r of byStatus.zone) lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        lines.push("");
    }
    if (byStatus.available.length > 0) {
        lines.push("### 🎯 Available for Registration");
        for (const r of byStatus.available) lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        lines.push("");
    }
    if (byStatus.taken.length > 0) {
        lines.push("### ❌ Taken");
        for (const r of byStatus.taken) lines.push(`- **${r.domain}**`);
        lines.push("");
    }
    if (byStatus.unsupported.length > 0) {
        lines.push("### ⚠️ TLD Not Supported by CF Registrar API");
        for (const r of byStatus.unsupported) lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        lines.push("");
    }
    if (byStatus.unknown.length > 0) {
        lines.push("### ❓ Unknown");
        for (const r of byStatus.unknown) lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        lines.push("");
    }

    lines.push(`**Summary:** ${byStatus.available.length} available | ${byStatus.owned.length} owned | ${byStatus.zone.length} zones | ${byStatus.taken.length} taken | ${byStatus.unsupported.length} unsupported | ${byStatus.unknown.length} unknown`);

    return textContent(lines.join("\n"));
}
