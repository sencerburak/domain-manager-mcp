import { z } from "zod";
import { requireZoneId } from "../../cloudflare/zones.js";
import { createDNSRecord } from "../../cloudflare/dns.js";
import { textContent, errorContent } from "../../types.js";

export const name = "create_dns_record";
export const description =
    "Create a new DNS record in a Cloudflare zone. WRITE OPERATION — adds a live DNS record. Double-check content/type before confirming. Supports A, AAAA, CNAME, MX, TXT, NS, SRV, CAA, PTR.";

export const inputSchema = z.object({
    domain: z.string().describe("Apex domain (zone name), e.g. 'example.com'"),
    type: z
        .enum(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR"])
        .describe("DNS record type"),
    name: z
        .string()
        .describe(
            "Record name. Use '@' or the apex domain for root, or 'www' for a subdomain. Full FQDN also accepted.",
        ),
    content: z.string().describe("Record content (IP address, target hostname, TXT value, etc.)"),
    ttl: z
        .number()
        .int()
        .min(60)
        .max(86400)
        .default(3600)
        .describe("TTL in seconds (60–86400). Use 1 for automatic (CF-proxied records)."),
    proxied: z
        .boolean()
        .optional()
        .describe("Proxy through Cloudflare (hides origin IP, enables CDN). Only for A/AAAA/CNAME."),
    priority: z
        .number()
        .int()
        .min(0)
        .max(65535)
        .optional()
        .describe("Priority (required for MX, SRV records)"),
    comment: z.string().max(100).optional().describe("Optional comment/note for this record"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const domain = args.domain.toLowerCase().replace(/\.$/, "");
    const zoneId = await requireZoneId(domain);

    // Normalise record name
    let recordName = args.name === "@" ? domain : args.name;
    if (!recordName.includes(".")) {
        recordName = `${recordName}.${domain}`;
    }

    try {
        const record = await createDNSRecord(zoneId, {
            type: args.type,
            name: recordName,
            content: args.content,
            ttl: args.proxied ? 1 : args.ttl,
            proxied: args.proxied,
            priority: args.priority,
            comment: args.comment,
        });

        const proxyInfo =
            record.proxied ? " (proxied through CF)" : "";
        return textContent(
            [
                `## DNS Record Created ✅`,
                `- **Record ID:** \`${record.id}\``,
                `- **Type:** ${record.type}`,
                `- **Name:** ${record.name}`,
                `- **Content:** ${record.content}${proxyInfo}`,
                `- **TTL:** ${record.ttl === 1 ? "auto" : record.ttl}s`,
                record.priority !== undefined ? `- **Priority:** ${record.priority}` : null,
                `\n*Record is now live. DNS propagation typically takes 1–5 minutes.*`,
            ]
                .filter((l) => l !== null)
                .join("\n"),
        );
    } catch (e) {
        return errorContent(
            `Failed to create DNS record: ${e instanceof Error ? e.message : String(e)}`,
        );
    }
}
