import { z } from "zod";
import { requireZoneId } from "../../cloudflare/zones.js";
import { listDNSRecords, formatRecord } from "../../cloudflare/dns.js";
import { textContent } from "../../types.js";

export const name = "get_dns_records";
export const description =
    "List DNS records for a domain zone. Filter by record type (A, CNAME, MX, TXT, etc.) or name prefix. Returns record IDs needed for update/delete operations.";

export const inputSchema = z.object({
    domain: z.string().describe("Apex domain name, e.g. 'example.com'"),
    type: z
        .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR"])
        .optional()
        .describe("Filter by record type"),
    name: z.string().optional().describe("Filter by exact record name, e.g. 'www.example.com'"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase().replace(/\.$/, "");
    const zoneId = await requireZoneId(domain);

    const records = await listDNSRecords(zoneId, {
        type: args.type,
        name: args.name,
    });

    if (records.length === 0) {
        const filter = [args.type && `type=${args.type}`, args.name && `name=${args.name}`]
            .filter(Boolean)
            .join(", ");
        return textContent(
            `No DNS records found for ${domain}${filter ? ` (${filter})` : ""}.`,
        );
    }

    const lines: string[] = [
        `## DNS Records: ${domain}  (${records.length} record${records.length === 1 ? "" : "s"})`,
        "",
        `${"ID (short)".padEnd(10)} ${"Type".padEnd(6)} ${"Name".padEnd(40)} ${"Content".padEnd(40)} ${"TTL"}`,
        "-".repeat(105),
    ];

    // Group by type for readability
    const byType = new Map<string, typeof records>();
    for (const r of records) {
        if (!byType.has(r.type)) byType.set(r.type, []);
        byType.get(r.type)!.push(r);
    }

    for (const [type, recs] of [...byType.entries()].sort()) {
        lines.push(`\n### ${type}`);
        for (const r of recs.sort((a, b) => a.name.localeCompare(b.name))) {
            lines.push(formatRecord(r));
        }
    }

    lines.push(`\n*Record IDs are the full 32-char string shown as first 8 chars above.*`);
    lines.push(
        `To modify: \`update_dns_record({ domain: "${domain}", record_id: "<full id>", ... })\``,
    );

    return textContent(lines.join("\n"));
}
