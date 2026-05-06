// Porkbun authenticated client for domain availability checks
// Uses PORKBUN_API_KEY and PORKBUN_API_SECRET environment variables

const BASE_URL = "https://api.porkbun.com/api/json/v3";

interface PorkbunCheckResponse {
    status: "success" | "error";
    available?: boolean;
    premium?: number;
    pricing?: {
        registration: number;
        renewal: number;
        transfer: number;
    };
    message?: string;
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
 * Check domain availability on Porkbun using authenticated API
 * Returns null if credentials not configured
 */
export async function checkPorkbunDomain(domain: string): Promise<PorkbunAvailability | null> {
    const apiKey = process.env.PORKBUN_API_KEY;
    const apiSecret = process.env.PORKBUN_API_SECRET;

    if (!apiKey || !apiSecret) {
        return null; // Not configured
    }

    try {
        const response = await fetch(`${BASE_URL}/domain/check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                domain,
                apikey: apiKey,
                secretapikey: apiSecret,
            }),
        });

        const data: PorkbunCheckResponse = await response.json();

        if (data.status === "error") {
            return {
                available: false,
                premium: false,
                error: data.message,
            };
        }

        if (data.status === "success" && data.available !== undefined) {
            return {
                available: data.available,
                premium: (data.premium ?? 0) > 0,
                registration: data.pricing?.registration,
                renewal: data.pricing?.renewal,
                transfer: data.pricing?.transfer,
            };
        }

        return null;
    } catch (error) {
        console.error(`[Porkbun] Error checking ${domain}:`, error);
        return null;
    }
}

/**
 * Batch check multiple domains on Porkbun
 * Returns a map of domain -> availability
 */
export async function checkPorkbunDomainsBatch(domains: string[]): Promise<Map<string, PorkbunAvailability>> {
    const apiKey = process.env.PORKBUN_API_KEY;
    const apiSecret = process.env.PORKBUN_API_SECRET;

    if (!apiKey || !apiSecret) {
        return new Map(); // Not configured
    }

    const results = new Map<string, PorkbunAvailability>();

    // Porkbun doesn't have batch API, so check sequentially with rate limit
    for (const domain of domains) {
        const result = await checkPorkbunDomain(domain);
        if (result) {
            results.set(domain, result);
        }
        // Rate limit: 100ms between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
}
