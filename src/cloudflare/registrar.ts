import { cfClient, getAccountId, CFError } from "./client.js";
import type { CFRegistrarDomain, CFTLDPolicy, RDAPResult } from "../types.js";

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
        return await cfClient.get<CFRegistrarDomain>(
            `/accounts/${accountId}/registrar/domains/${encodeURIComponent(domainName)}`,
        );
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

// ─── Availability check via public RDAP ──────────────────────────────────────

/**
 * Check domain availability using the public RDAP protocol.
 * RDAP (RFC 7483) is a standard public registry lookup with no auth required.
 * 404 = domain not registered (likely available); 200 = domain taken.
 */
export async function checkAvailabilityRDAP(domain: string): Promise<RDAPResult> {
    try {
        const resp = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
            headers: { Accept: "application/rdap+json" },
            signal: AbortSignal.timeout(8000),
        });

        if (resp.status === 404) {
            return { registered: false };
        }

        if (!resp.ok) {
            // Can't determine — treat as unknown, not available
            return { registered: true };
        }

        const data = (await resp.json()) as {
            events?: { eventAction: string; eventDate: string }[];
            entities?: { roles: string[]; vcardArray?: unknown[] }[];
        };

        const expiry = data.events?.find((e) => e.eventAction === "expiration")?.eventDate;
        const created = data.events?.find((e) => e.eventAction === "registration")?.eventDate;

        // Find registrar entity
        const registrarEntity = data.entities?.find((e) => e.roles?.includes("registrar"));
        const vcardArray = registrarEntity?.vcardArray as Array<Array<unknown>> | undefined;
        const fnEntry = vcardArray?.[1]?.find((v: unknown) => Array.isArray(v) && (v as unknown[])[0] === "fn") as unknown[] | undefined;
        const registrar = fnEntry?.[3] as string | undefined;

        return { registered: true, registrar, expires: expiry, created };
    } catch {
        // Network error / timeout — assume taken to be safe
        return { registered: true };
    }
}
