import { z } from "zod";
import { requireZoneId } from "../../cloudflare/zones.js";
import { updateDNSRecord, listDNSRecords } from "../../cloudflare/dns.js";
import { textContent, errorContent } from "../../types.js";

export const name = "update_dns_record";
export const description =
    "Update an existing DNS record in a Cloudflare zone. WRITE OPERATION — modifies a live DNS record. Use get_dns_records to find the record_id first. Only specified fields are changed.";

export const inputSchema = z.object({
    domain: z.string().describe("Apex domain (zone name), e.g. 'example.com'"),
    record_id: z
        .string()
        .min(8)
        .describe("Record ID from get_dns_records (32-char hex string)"),
    content: z.string().optional().describe("New content (IP, hostname, TXT value, etc.)"),
    ttl: z
        .number()
        .int()
        .min(1)
        .max(86400)
        .optional()
        .describe("New TTL in seconds. Use 1 for automatic (proxied records)."),
    proxied: z
        .boolean()
        .optional()
        .describe("Update proxy status (CF CDN). Only valid for A/AAAA/CNAME records."),
    comment: z.string().max(100).optional().describe("Update or clear the record comment"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase().replace(/\.$/, "");
    const zoneId = await requireZoneId(domain);

    // Find the existing record for confirmation context
    const allRecords = await listDNSRecords(zoneId);
    const existing = allRecords.find((r) => r.id === args.record_id || r.id.startsWith(args.record_id));

    if (!existing) {
        return errorContent(
            `Record ID "${args.record_id}" not found in zone ${domain}.\n` +
            `Use get_dns_records({ domain: "${domain}" }) to list records with their IDs.`,
        );
    }

    const updates: Record<string, unknown> = {};
    if (args.content !== undefined) updates.content = args.content;
    if (args.ttl !== undefined) updates.ttl = args.ttl;
    if (args.proxied !== undefined) updates.proxied = args.proxied;
    if (args.comment !== undefined) updates.comment = args.comment;

    try {
        const result = await updateDNSRecord(zoneId, existing.id, updates);

        const changes = Object.entries(updates)
            .map(([k, v]) => {
                const before = existing[k as keyof typeof existing];
                return `- **${k}:** \`${before}\` → \`${v}\``;
            })
            .join("\n");

        return textContent(
            [
                `## DNS Record Updated ✅`,
                `- **Record:** ${existing.type} ${existing.name}`,
                `- **ID:** \`${result.id}\``,
                "",
                "**Changes:**",
                changes,
                `\n*Changes are live. DNS propagation typically takes 1–5 minutes.*`,
            ].join("\n"),
        );
    } catch (e) {
        return errorContent(
            `Failed to update record ${args.record_id}: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}
