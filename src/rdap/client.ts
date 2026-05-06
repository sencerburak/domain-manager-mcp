// RDAP client — authoritative domain registration status.
//
// RDAP (RFC 7483/9083) provides definitive registration data directly from
// registry operators. We route all queries through rdap.org which redirects
// to the correct per-TLD RDAP server.
//
// Key semantics:
//   HTTP 200  → domain IS registered (taken)
//   HTTP 404  → domain is NOT registered (available)
//   other     → unknown (server error, rate limit, etc.)
//
// ⚠️  RDAP coverage is NOT universal. Some popular TLDs (.io, .co, .me, .de,
//     .eu, .gg, .sh, .so, .ru, .cn, .us, .mx) have NO RDAP server and
//     rdap.org returns 404 for ALL domains in those TLDs, whether registered
//     or not. We maintain a curated set below and only return definitive
//     results for supported TLDs.
//
// Egress proxy note: mcp-domain-manager routes outbound through agent-egress.
// The allowlist must include the actual RDAP server rdap.org redirects to
// (rdap.org itself redirects — it does NOT proxy server-side).
// Currently allowed: rdap.org, rdap.verisign.com, rdap.nominet.uk,
//   rdap.publicinterestregistry.org, rdap.identitydigital.services,
//   rdap.centralnic.com, pubapi.registry.google, rdap.nic.*, rdap.radix.host

const RDAP_BASE = "https://rdap.org";

/**
 * TLDs confirmed to have working RDAP servers accessible through the egress
 * proxy. Updated May 2026 from https://data.iana.org/rdap/dns.json
 *
 * For TLDs NOT in this set, checkRDAP() returns null — meaning unknown.
 * Do NOT trust a 404 from rdap.org for unlisted TLDs (it would be a false
 * "available" result for a registered domain).
 */
export const RDAP_SUPPORTED_TLDS = new Set([
    // Verisign — rdap.verisign.com
    "com", "net",
    // PIR — rdap.publicinterestregistry.org
    "org",
    // Google Registry — pubapi.registry.google
    "app", "dev",
    // Identity Digital — rdap.identitydigital.services
    "ai", "pro", "agency", "codes", "digital", "email", "global", "info",
    "live", "media", "news", "ninja", "studio", "today", "tools", "world",
    // CentralNic — rdap.centralnic.com
    "xyz", "fm",
    // Radix — rdap.radix.host
    "tech", "site", "store", "space", "online",
    // Nominet — rdap.nominet.uk
    "uk",
    // rdap.nic.* pattern (catch-all for many gTLD/ccTLDs)
    "fr", "pm", "tv", "ly", "design", "biz",
]);

export interface RDAPResult {
    /** True = domain is definitely registered (taken). False = definitely not registered (available). */
    registered: boolean;
    /** Registrar name, if present in RDAP response. */
    registrar?: string;
    /** Expiration date (ISO 8601) if present. */
    expiresAt?: string;
    /** Raw RDAP status codes array. */
    rdapStatus?: string[];
}

/**
 * Check if a domain is registered via RDAP.
 *
 * Returns:
 *   RDAPResult { registered: true }  — domain is taken
 *   RDAPResult { registered: false } — domain is available
 *   null                             — TLD has no RDAP, or request failed
 */
export async function checkRDAP(domain: string): Promise<RDAPResult | null> {
    const tld = domain.split(".").slice(-1)[0].toLowerCase();

    if (!RDAP_SUPPORTED_TLDS.has(tld)) {
        return null; // No RDAP for this TLD — can't determine status
    }

    try {
        const response = await fetch(`${RDAP_BASE}/domain/${encodeURIComponent(domain)}`, {
            headers: { Accept: "application/rdap+json" },
        });

        if (response.status === 404) {
            return { registered: false };
        }

        if (response.ok) {
            const data = await response.json() as {
                entities?: Array<{
                    roles?: string[];
                    vcardArray?: [string, Array<[string, unknown, string, string]>];
                }>;
                events?: Array<{ eventAction: string; eventDate: string }>;
                status?: string[];
            };

            const registrar = data.entities
                ?.find((e) => e.roles?.includes("registrar"))
                ?.vcardArray?.[1]
                ?.find((a) => a[0] === "fn")?.[3] as string | undefined;

            const expiresAt = data.events?.find((e) => e.eventAction === "expiration")?.eventDate;

            return {
                registered: true,
                registrar,
                expiresAt,
                rdapStatus: data.status,
            };
        }

        // 429 rate limit, 5xx errors — unknown
        console.error(`[RDAP] HTTP ${response.status} for ${domain}`);
        return null;
    } catch (error) {
        console.error(`[RDAP] Error checking ${domain}:`, error);
        return null;
    }
}

/**
 * Batch-check multiple domains via RDAP.
 * Skips domains in TLDs without RDAP (they won't appear in the result map).
 * Uses a small delay between requests to be polite to RDAP servers.
 */
export async function checkRDAPBatch(
    domains: string[],
    delayMs = 150,
): Promise<Map<string, RDAPResult>> {
    const results = new Map<string, RDAPResult>();

    for (let i = 0; i < domains.length; i++) {
        const result = await checkRDAP(domains[i]);
        if (result !== null) {
            results.set(domains[i], result);
        }
        if (i < domains.length - 1 && delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
        }
    }

    return results;
}
