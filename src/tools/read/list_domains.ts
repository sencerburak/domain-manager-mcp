import { z } from "zod";
import { listZones } from "../../cloudflare/zones.js";
import { listRegistrarDomains } from "../../cloudflare/registrar.js";
import { textContent } from "../../types.js";
import type { CFZone, CFRegistrarDomain } from "../../types.js";

export const name = "list_domains";
export const description =
    "List all domains in your Cloudflare account: both zones (DNS managed by CF) and domains registered through CF Registrar. Shows expiry, status, and plan.";

export const inputSchema = z.object({
    filter: z
        .enum(["all", "zones", "registrar"])
        .default("all")
        .describe("Which domains to list: all, only zones, or only registrar domains"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const lines: string[] = [];

    // Fetch zones
    let zones: CFZone[] = [];
    if (args.filter === "all" || args.filter === "zones") {
        zones = await listZones();
    }

    // Fetch registrar domains
    let registrarDomains: CFRegistrarDomain[] = [];
    if (args.filter === "all" || args.filter === "registrar") {
        try {
            registrarDomains = await listRegistrarDomains();
        } catch {
            /* registrar not enabled / no domains */
        }
    }

    if (zones.length === 0 && registrarDomains.length === 0) {
        return textContent("No domains found in your Cloudflare account.");
    }

    // Build a map of registrar data by domain name
    const registrarMap = new Map(registrarDomains.map((d) => [d.domain, d]));

    if (zones.length > 0) {
        lines.push(`## Cloudflare Zones (${zones.length})\n`);
        lines.push(`${"Domain".padEnd(40)} ${"Status".padEnd(12)} ${"Plan".padEnd(15)} Registrar`);
        lines.push("-".repeat(85));

        for (const zone of zones.sort((a, b) => a.name.localeCompare(b.name))) {
            const reg = registrarMap.get(zone.name);
            const regInfo = reg
                ? `CF (expires ${reg.expires_at?.slice(0, 10) ?? "?"})`
                : "external";
            lines.push(
                `${zone.name.padEnd(40)} ${zone.status.padEnd(12)} ${zone.plan.name.padEnd(15)} ${regInfo}`,
            );
        }
    }

    // Show registrar domains NOT already shown as zones
    const zoneNames = new Set(zones.map((z) => z.name));
    const registrarOnly = registrarDomains.filter((d) => !zoneNames.has(d.domain));

    if (registrarOnly.length > 0) {
        if (lines.length > 0) lines.push("");
        lines.push(`## CF Registrar Only (${registrarOnly.length})\n`);
        lines.push(`${"Domain".padEnd(40)} ${"Status".padEnd(15)} Expires`);
        lines.push("-".repeat(65));

        for (const d of registrarOnly.sort((a, b) => a.domain.localeCompare(b.domain))) {
            const status = d.status?.join(", ") ?? "unknown";
            lines.push(`${d.domain.padEnd(40)} ${status.padEnd(15)} ${d.expires_at?.slice(0, 10) ?? "unknown"}`);
        }
    }

    lines.push(`\nTotal: ${zones.length} zone(s), ${registrarDomains.length} CF Registrar domain(s)`);

    return textContent(lines.join("\n"));
}
