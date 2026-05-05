import { cfClient } from "./client.js";
import type { CFDNSRecord, CreateDNSRecordParams, UpdateDNSRecordParams } from "../types.js";

/** List DNS records for a zone, with optional filters. */
export async function listDNSRecords(
    zoneId: string,
    opts: { type?: string; name?: string } = {},
): Promise<CFDNSRecord[]> {
    const params = new URLSearchParams({ per_page: "100" });
    if (opts.type) params.set("type", opts.type);
    if (opts.name) params.set("name", opts.name);

    const records: CFDNSRecord[] = [];
    let page = 1;
    while (true) {
        params.set("page", String(page));
        const result = await cfClient.get<CFDNSRecord[]>(`/zones/${zoneId}/dns_records?${params}`);
        if (!result || result.length === 0) break;
        records.push(...result);
        if (result.length < 100) break;
        page++;
    }
    return records;
}

/** Create a DNS record. */
export async function createDNSRecord(
    zoneId: string,
    params: CreateDNSRecordParams,
): Promise<CFDNSRecord> {
    return cfClient.post<CFDNSRecord>(`/zones/${zoneId}/dns_records`, params);
}

/** Update a DNS record (partial patch). */
export async function updateDNSRecord(
    zoneId: string,
    recordId: string,
    params: UpdateDNSRecordParams,
): Promise<CFDNSRecord> {
    return cfClient.patch<CFDNSRecord>(`/zones/${zoneId}/dns_records/${recordId}`, params);
}

/** Delete a DNS record. Returns the deleted record's ID. */
export async function deleteDNSRecord(zoneId: string, recordId: string): Promise<{ id: string }> {
    return cfClient.delete<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`);
}

/** Format a DNS record for display. */
export function formatRecord(r: CFDNSRecord): string {
    const proxy = r.proxied ? " [proxied]" : "";
    const prio = r.priority !== undefined ? ` priority=${r.priority}` : "";
    return `${r.id.slice(0, 8)}  ${r.type.padEnd(6)} ${r.name.padEnd(40)} → ${r.content}  ttl=${r.ttl}${prio}${proxy}`;
}
