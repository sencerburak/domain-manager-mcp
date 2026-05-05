import { z } from "zod";
import { requireZoneId } from "../../cloudflare/zones.js";
import { listDNSRecords, deleteDNSRecord } from "../../cloudflare/dns.js";
import { textContent, errorContent } from "../../types.js";

export const name = "delete_dns_record";
export const description =
    "Delete a DNS record from a Cloudflare zone. WRITE OPERATION — permanently removes the record. This cannot be undone. Use get_dns_records to find the record_id first.";

export const inputSchema = z.object({
    domain: z.string().describe("Apex domain (zone name), e.g. 'example.com'"),
    record_id: z
        .string()
        .min(8)
        .describe("Record ID from get_dns_records (32-char hex string, or first 8 chars)"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase().replace(/\.$/, "");
    const zoneId = await requireZoneId(domain);

    // Find the record first for confirmation context
    const allRecords = await listDNSRecords(zoneId);
    const record = allRecords.find((r) => r.id === args.record_id || r.id.startsWith(args.record_id));

    if (!record) {
        return errorContent(
            `Record ID "${args.record_id}" not found in zone ${domain}.\n` +
            `Use get_dns_records({ domain: "${domain}" }) to list records with their IDs.`,
        );
    }

    try {
        await deleteDNSRecord(zoneId, record.id);

        return textContent(
            [
                `## DNS Record Deleted ✅`,
                `- **Type:** ${record.type}`,
                `- **Name:** ${record.name}`,
                `- **Content:** ${record.content}`,
                `- **ID:** \`${record.id}\``,
                `\n*Record has been removed. Changes are live immediately.*`,
            ].join("\n"),
        );
    } catch (e) {
        return errorContent(
            `Failed to delete record ${args.record_id}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}
