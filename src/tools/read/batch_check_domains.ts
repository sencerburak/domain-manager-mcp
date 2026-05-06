import { z } from "zod";
import { getZoneByName } from "../../cloudflare/zones.js";
import { getRegistrarDomain, checkAvailabilityRDAP } from "../../cloudflare/registrar.js";
import { textContent } from "../../types.js";

export const name = "batch_check_domains";
export const description =
    "Batch-check availability of multiple domain names across multiple TLDs. Returns a matrix of results showing which are registered with your account, available, or taken. Much faster than checking individually.";

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
    status: "owned" | "zone" | "available" | "taken" | "unknown";
    notes?: string;
};

export async function handler(args: z.infer<typeof inputSchema>) {
    const { names, tlds } = args;

    // Normalize TLDs
    const normalizedTlds = tlds.map((tld) => tld.replace(/^\./, "").toLowerCase());

    const results: CheckResult[] = [];

    // Check each name + TLD combination
    for (const name of names) {
        for (const tld of normalizedTlds) {
            const domain = `${name.toLowerCase()}.${tld}`;

            try {
                // 1. Check CF registrar
                const registrarDomain = await getRegistrarDomain(domain);
                if (registrarDomain) {
                    results.push({
                        domain,
                        status: "owned",
                        notes: `CF Registrar, expires ${registrarDomain.expires_at || "unknown"}`,
                    });
                    continue;
                }

                // 2. Check CF zones
                const zone = await getZoneByName(domain);
                if (zone) {
                    results.push({
                        domain,
                        status: "zone",
                        notes: `Active CF zone (${zone.status})`,
                    });
                    continue;
                }

                // 3. Check RDAP for availability
                const rdap = await checkAvailabilityRDAP(domain);
                if (rdap.error) {
                    // RDAP lookup failed — can't determine
                    results.push({
                        domain,
                        status: "unknown",
                        notes: `${rdap.error} (try check_domain for details)`,
                    });
                } else if (rdap.registered) {
                    results.push({
                        domain,
                        status: "taken",
                        notes: `Registered with ${rdap.registrar || "unknown"}`,
                    });
                } else {
                    results.push({
                        domain,
                        status: "available",
                    });
                }
            } catch (error) {
                results.push({
                    domain,
                    status: "unknown",
                    notes: `Error checking: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        }
    }

    // Format results: group by status for readability
    const byStatus = {
        owned: results.filter((r) => r.status === "owned"),
        zone: results.filter((r) => r.status === "zone"),
        available: results.filter((r) => r.status === "available"),
        taken: results.filter((r) => r.status === "taken"),
        unknown: results.filter((r) => r.status === "unknown"),
    };

    const lines: string[] = ["## Batch Domain Check Results\n"];
    lines.push(`Checked ${results.length} domain(s) across ${names.length} name(s) × ${normalizedTlds.length} TLD(s)\n`);

    if (byStatus.owned.length > 0) {
        lines.push("### ✅ Your Domains (Cloudflare Registrar)");
        for (const r of byStatus.owned) {
            lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        }
        lines.push("");
    }

    if (byStatus.zone.length > 0) {
        lines.push("### ℹ️ Active Zones (Registered elsewhere)");
        for (const r of byStatus.zone) {
            lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        }
        lines.push("");
    }

    if (byStatus.available.length > 0) {
        lines.push("### 🎯 Available for Registration");
        for (const r of byStatus.available) {
            lines.push(`- **${r.domain}**`);
        }
        lines.push("");
    }

    if (byStatus.taken.length > 0) {
        lines.push("### ❌ Taken / Unavailable");
        for (const r of byStatus.taken) {
            lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        }
        lines.push("");
    }

    if (byStatus.unknown.length > 0) {
        lines.push("### ❓ Unknown (RDAP lookup failed)");
        for (const r of byStatus.unknown) {
            lines.push(`- **${r.domain}** ${r.notes ? `(${r.notes})` : ""}`);
        }
        lines.push("");
    }

    lines.push(`\n**Summary:** ${byStatus.available.length} available | ${byStatus.owned.length} owned | ${byStatus.zone.length} zones | ${byStatus.taken.length} taken | ${byStatus.unknown.length} unknown`);

    return textContent(lines.join("\n"));
}
