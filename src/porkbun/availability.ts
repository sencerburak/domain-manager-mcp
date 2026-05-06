// Porkbun authenticated client for domain availability checks
// Uses PORKBUN_API_KEY and PORKBUN_API_SECRET environment variables
// Rate limit: 1 check per 10 seconds per account

const BASE_URL = "https://api.porkbun.com/api/json/v3";

interface PorkbunCheckDomainResponse {
    status: "SUCCESS" | "ERROR";
    response?: {
        avail: "yes" | "no";
        type?: string;
        price?: string;        // registration price in USD
        premium?: "yes" | "no";
        regularPrice?: string;
        additional?: {
            renewal?: { price?: string };
            transfer?: { price?: string };
        };
    };
    message?: string;
    code?: string;
}

export interface PorkbunAvailability {
    available: boolean;
    premium: boolean;
    registration?: number;
    renewal?: number;
    transfer?: number;
    error?: string;
}

/**
 * Check domain availability on Porkbun using authenticated API.
 * Endpoint: POST /domain/checkDomain/{domain}
 * Rate limit: 1 check per 10 seconds per account.
 * Returns null if credentials not configured or request fails.
 */
export async function checkPorkbunDomain(domain: string): Promise<PorkbunAvailability | null> {
    const apiKey = process.env.PORKBUN_API_KEY;
    const apiSecret = process.env.PORKBUN_API_SECRET;

    if (!apiKey || !apiSecret) {
        return null; // Not configured
    }

    try {
        const response = await fetch(`${BASE_URL}/domain/checkDomain/${encodeURIComponent(domain)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                apikey: apiKey,
                secretapikey: apiSecret,
            }),
        });

        const data: PorkbunCheckDomainResponse = await response.json();

        if (data.status === "ERROR") {
            return {
                available: false,
                premium: false,
                error: data.message ?? data.code,
            };
        }

        if (data.status === "SUCCESS" && data.response) {
            const r = data.response;
            return {
                available: r.avail === "yes",
                premium: r.premium === "yes",
                registration: r.price ? parseFloat(r.price) : undefined,
                renewal: r.additional?.renewal?.price ? parseFloat(r.additional.renewal.price) : undefined,
                transfer: r.additional?.transfer?.price ? parseFloat(r.additional.transfer.price) : undefined,
            };
        }

        return null;
    } catch (error) {
        console.error(`[Porkbun] Error checking ${domain}:`, error);
        return null;
    }
}

/**
 * Batch check multiple domains on Porkbun.
 * Respects the 1-per-10s rate limit with 11s delay between requests.
 * Returns a map of domain -> availability.
 * Returns empty map if credentials not configured.
 */
export async function checkPorkbunDomainsBatch(domains: string[]): Promise<Map<string, PorkbunAvailability>> {
    const apiKey = process.env.PORKBUN_API_KEY;
    const apiSecret = process.env.PORKBUN_API_SECRET;

    if (!apiKey || !apiSecret || domains.length === 0) {
        return new Map();
    }

    const results = new Map<string, PorkbunAvailability>();

    for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];
        const result = await checkPorkbunDomain(domain);
        if (result) {
            results.set(domain, result);
        }
        // Rate limit: 1 check per 10 seconds per account
        if (i < domains.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 11000));
        }
    }

    return results;
}
