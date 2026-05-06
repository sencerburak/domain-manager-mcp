import { cfClient, getAccountId, CFError } from "./client.js";
import type { CFRegistrarDomain, CFTLDPolicy, CFDomainCheckResult } from "../types.js";

/** List all domains registered through Cloudflare Registrar. */
export async function listRegistrarDomains(): Promise<CFRegistrarDomain[]> {
    const accountId = await getAccountId();
    const domains: CFRegistrarDomain[] = [];
    let page = 1;
    while (true) {
        const result = await cfClient.get<CFRegistrarDomain[]>(
            `/accounts/${accountId}/registrar/domains?per_page=50&page=${page}`,
        );
        if (!result || result.length === 0) break;
        domains.push(...result);
        if (result.length < 50) break;
        page++;
    }
    return domains;
}

/** Get details for a specific domain in Cloudflare Registrar. Returns null if not found. */
export async function getRegistrarDomain(domainName: string): Promise<CFRegistrarDomain | null> {
    const accountId = await getAccountId();
    try {
        const result = await cfClient.get<CFRegistrarDomain>(
            `/accounts/${accountId}/registrar/domains/${encodeURIComponent(domainName)}`,
        );
        // Defensive: ensure result actually has domain ownership indicators.
        // If the domain is registered with CF Registrar, it will have a registered_at timestamp.
        // If API returns empty object or template, registered_at will be null or undefined.
        if (!result || !result.domain || result.registered_at == null) {
            if (result) console.error(`[DEBUG] getRegistrarDomain(${domainName}): got result but registered_at is null/undefined:`, result);
            return null;
        }
        return result;
    } catch (e) {
        if (e instanceof CFError && (e.status === 404 || e.code === 1224)) return null;
        throw e;
    }
}

/** Get TLD pricing policies from Cloudflare Registrar. */
export async function getTLDPolicies(tlds?: string[]): Promise<CFTLDPolicy[]> {
    const accountId = await getAccountId();
    const all = await cfClient.get<CFTLDPolicy[]>(
        `/accounts/${accountId}/registrar/tld-policies`,
    );
    if (!tlds || tlds.length === 0) return all;
    const set = new Set(tlds.map((t) => t.toLowerCase().replace(/^\./, "")));
    return all.filter((p) => set.has(p.tld.toLowerCase()));
}

/**
 * Register a domain via Cloudflare Registrar.
 * The domain must already have a zone on Cloudflare (or be a new purchase).
 */
export async function registerDomain(
    domainName: string,
    opts: { auto_renew?: boolean; privacy?: boolean; years?: number } = {},
): Promise<CFRegistrarDomain> {
    const accountId = await getAccountId();
    const body: Record<string, unknown> = {
        name: domainName,
        auto_renew: opts.auto_renew ?? true,
        privacy: opts.privacy ?? false,
    };
    if (opts.years) body.years = opts.years;
    return cfClient.post<CFRegistrarDomain>(
        `/accounts/${accountId}/registrar/domains`,
        body,
    );
}

/** Renew a domain registered through Cloudflare Registrar. */
export async function renewDomain(
    domainName: string,
    years: number = 1,
): Promise<CFRegistrarDomain> {
    const accountId = await getAccountId();
    return cfClient.post<CFRegistrarDomain>(
        `/accounts/${accountId}/registrar/domains/${encodeURIComponent(domainName)}/renew`,
        { years },
    );
}

/** Update registrar settings (auto_renew, locked, privacy). */
export async function updateDomainSettings(
    domainName: string,
    settings: { auto_renew?: boolean; locked?: boolean; privacy?: boolean },
): Promise<CFRegistrarDomain> {
    const accountId = await getAccountId();
    return cfClient.put<CFRegistrarDomain>(
        `/accounts/${accountId}/registrar/domains/${encodeURIComponent(domainName)}`,
        settings,
    );
}

// ─── Availability check via CF Registrar API ─────────────────────────────────

/**
 * Check availability of up to 20 domains per call using Cloudflare's
 * authoritative domain-check endpoint (POST /registrar/domain-check).
 * Handles chunking automatically for larger lists.
 *
 * Returns one CFDomainCheckResult per domain:
 *   registrable: true                        → available + pricing included
 *   registrable: false, reason: domain_unavailable        → taken
 *   registrable: false, reason: extension_not_supported   → TLD not in CF Registrar at all
 *   registrable: false, reason: extension_not_supported_via_api → available via CF dashboard only
 *   registrable: false, reason: domain_premium            → available but premium priced
 */
export async function checkDomainsBatch(domains: string[]): Promise<CFDomainCheckResult[]> {
    if (domains.length === 0) return [];
    const accountId = await getAccountId();
    const results: CFDomainCheckResult[] = [];
    // API limit: 20 domains per request
    for (let i = 0; i < domains.length; i += 20) {
        const chunk = domains.slice(i, i + 20);
        const data = await cfClient.post<{ domains: CFDomainCheckResult[] }>(
            `/accounts/${accountId}/registrar/domain-check`,
            { domains: chunk },
        );
        results.push(...(data.domains ?? []));
    }
    return results;
}
