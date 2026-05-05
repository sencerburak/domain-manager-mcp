import { z } from "zod";
import { getZoneByName } from "../../cloudflare/zones.js";
import { getRegistrarDomain } from "../../cloudflare/registrar.js";
import { listDNSRecords } from "../../cloudflare/dns.js";
import { textContent } from "../../types.js";

export const name = "get_domain";
export const description =
    "Get detailed information about a specific domain: CF zone status, registrar details (if registered with CF), nameservers, DNSSEC, and a DNS record summary.";

export const inputSchema = z.object({
    domain: z.string().describe("Domain name, e.g. 'example.com'"),
    include_dns_summary: z
        .boolean()
        .default(true)
        .describe("Include a count of DNS records by type"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase().replace(/\.$/, "");
    const lines: string[] = [`## ${domain}\n`];

    const [zone, registrar] = await Promise.all([getZoneByName(domain), getRegistrarDomain(domain)]);

    if (!zone && !registrar) {
        return textContent(
            `Domain "${domain}" not found in your Cloudflare account.\n\n` +
            `To check availability: \`check_domain({ domain: "${domain}" })\``,
        );
    }

    // Zone info
    if (zone) {
        lines.push("### Cloudflare Zone");
        lines.push(`- **Zone ID:** \`${zone.id}\``);
        lines.push(`- **Status:** ${zone.status}`);
        lines.push(`- **Type:** ${zone.type}`);
        lines.push(`- **Plan:** ${zone.plan.name}`);
        lines.push(`- **Paused:** ${zone.paused}`);
        lines.push(`- **Created:** ${zone.created_on?.slice(0, 10)}`);
        lines.push(`- **Nameservers:** ${zone.name_servers.join(", ")}`);
        if (zone.original_name_servers?.length) {
            lines.push(`- **Original NS:** ${zone.original_name_servers.join(", ")}`);
        }
    }

    // Registrar info
    if (registrar) {
        if (lines.length > 2) lines.push("");
        lines.push("### Cloudflare Registrar");
        lines.push(`- **Registered:** ${registrar.registered_at?.slice(0, 10) ?? "unknown"}`);
        lines.push(`- **Expires:** ${registrar.expires_at?.slice(0, 10) ?? "unknown"}`);
        lines.push(`- **Auto-renew:** ${registrar.auto_renew ? "✅ yes" : "❌ no"}`);
        lines.push(`- **Locked:** ${registrar.locked ? "yes" : "no"}`);
        lines.push(`- **Privacy:** ${registrar.privacy ? "yes" : "no"}`);
        if (registrar.status?.length) {
            lines.push(`- **EPP Status:** ${registrar.status.join(", ")}`);
        }
        if (registrar.fees) {
            lines.push(
                `- **Renewal fee:** $${registrar.fees.renewal_fee}/yr  ` +
                `| Redemption: $${registrar.fees.redemption_fee}`,
            );
        }
    }

    // DNS record summary
    if (args.include_dns_summary && zone) {
        try {
            const records = await listDNSRecords(zone.id);
            if (records.length > 0) {
                const byType = records.reduce(
                    (acc, r) => {
                        acc[r.type] = (acc[r.type] ?? 0) + 1;
                        return acc;
                    },
                    {} as Record<string, number>,
                );
                lines.push("");
                lines.push("### DNS Summary");
                lines.push(`- **Total records:** ${records.length}`);
                for (const [type, count] of Object.entries(byType).sort()) {
                    lines.push(`- **${type}:** ${count}`);
                }
                lines.push(`\nTo see full records: \`get_dns_records({ domain: "${domain}" })\``);
            }
        } catch {
            /* non-fatal */
        }
    }

    return textContent(lines.join("\n"));
}
