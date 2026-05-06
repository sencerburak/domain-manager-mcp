const PORKBUN_BASE = "https://api.porkbun.com/api/json/v3";

export interface PorkbunTLDPrice {
    registration: string;
    renewal: string;
    transfer: string;
}

/**
 * Fetch domain pricing from Porkbun for the given TLDs.
 * Uses the public /pricing/get endpoint — no API key required.
 * Returns a Map keyed by lowercase TLD string (e.g. "com", "io").
 * Never throws — returns an empty Map on network/parse errors.
 */
export async function getPorkbunPricing(tlds: string[]): Promise<Map<string, PorkbunTLDPrice>> {
    const normalizedTlds = tlds.map((t) => t.toLowerCase().replace(/^\./, ""));
    try {
        const res = await fetch(`${PORKBUN_BASE}/pricing/get`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tlds: normalizedTlds }),
        });
        if (!res.ok) return new Map();
        const data = (await res.json()) as {
            status: string;
            pricing?: Record<string, { registration: string; renewal: string; transfer: string }>;
        };
        if (data.status !== "SUCCESS" || !data.pricing) return new Map();
        const result = new Map<string, PorkbunTLDPrice>();
        for (const [tld, prices] of Object.entries(data.pricing)) {
            result.set(tld.toLowerCase(), {
                registration: prices.registration,
                renewal: prices.renewal,
                transfer: prices.transfer,
            });
        }
        return result;
    } catch {
        return new Map();
    }
}
