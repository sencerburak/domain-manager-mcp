import { cfClient } from "./client.js";
import type { CFZone } from "../types.js";

/** Get all zones (domains) on this account. */
export async function listZones(): Promise<CFZone[]> {
    const zones: CFZone[] = [];
    let page = 1;
    while (true) {
        const result = await cfClient.get<CFZone[]>(`/zones?per_page=50&page=${page}`);
        if (!result || result.length === 0) break;
        zones.push(...result);
        if (result.length < 50) break;
        page++;
    }
    return zones;
}

/** Look up a single zone by domain name. Returns null if not found. */
export async function getZoneByName(domain: string): Promise<CFZone | null> {
    const result = await cfClient.get<CFZone[]>(`/zones?name=${encodeURIComponent(domain)}&per_page=1`);
    return result?.[0] ?? null;
}

/** Get a zone by its ID. */
export async function getZoneById(zoneId: string): Promise<CFZone> {
    return cfClient.get<CFZone>(`/zones/${zoneId}`);
}

/** Resolve a domain name to its zone ID, throwing if not found. */
export async function requireZoneId(domain: string): Promise<string> {
    // Strip any leading subdomain – CF zones are apex domains
    const apex = toApex(domain);
    const zone = await getZoneByName(apex);
    if (!zone) {
        throw new Error(
            `Domain "${apex}" not found in your Cloudflare zones. ` +
            `If this is a new domain use register_domain first, or add it to Cloudflare.`,
        );
    }
    return zone.id;
}

/** Strips subdomain prefix to return the apex/registrable domain. */
export function toApex(domain: string): string {
    // Very simple heuristic – works for common TLDs and two-label domains
    const parts = domain.replace(/\.$/, "").split(".");
    if (parts.length <= 2) return domain;
    // Two-part TLDs like .co.uk, .com.br → keep last 3 parts
    const knownMultiTlds = ["co.uk", "com.au", "com.br", "co.jp", "org.uk", "me.uk"];
    const lastTwo = parts.slice(-2).join(".");
    if (knownMultiTlds.includes(lastTwo)) {
        return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
}
