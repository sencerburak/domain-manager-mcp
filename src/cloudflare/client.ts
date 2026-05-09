import type { CFResponse, CFAccount } from "../types.js";
import { requestContext } from "../context.js";

const CF_BASE = "https://api.cloudflare.com/client/v4";

export class CFError extends Error {
    constructor(
        public readonly status: number,
        public readonly code: number,
        message: string,
    ) {
        super(message);
        this.name = "CFError";
    }
}

function getToken(): string {
    // Prefer the per-request token injected via Authorization header.
    const ctx = requestContext.getStore();
    const token = ctx?.cfToken ?? process.env.CLOUDFLARE_API_TOKEN;
    if (!token) throw new Error("No Cloudflare API token: provide Authorization: Bearer <token> or set CLOUDFLARE_API_TOKEN");
    return token;
}

async function cfFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${CF_BASE}${path}`;
    const method = init.method ?? "GET";

    console.log(`[CF API] ${method} ${url}`);
    if (init.body) {
        try {
            const body = JSON.parse(init.body as string);
            console.log(`[CF API] Request body:`, JSON.stringify(body));
        } catch (e) {
            console.log(`[CF API] Request body (raw):`, init.body);
        }
    }

    const resp = await fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${getToken()}`,
            "Content-Type": "application/json",
            ...init.headers,
        },
    });

    console.log(`[CF API] Response status: ${resp.status} ${resp.statusText}`);

    const body = (await resp.json()) as CFResponse<T>;

    if (!body.success) {
        console.error(`[CF API] Error response:`, JSON.stringify(body.errors));
        const err = body.errors[0] ?? { code: resp.status, message: resp.statusText };
        throw new CFError(resp.status, err.code, err.message);
    }

    console.log(`[CF API] Success response`);
    return body.result;
}

export const cfClient = {
    get: <T>(path: string) => cfFetch<T>(path),
    post: <T>(path: string, data?: unknown) =>
        cfFetch<T>(path, {
            method: "POST",
            body: data !== undefined ? JSON.stringify(data) : undefined,
        }),
    put: <T>(path: string, data: unknown) =>
        cfFetch<T>(path, { method: "PUT", body: JSON.stringify(data) }),
    patch: <T>(path: string, data: unknown) =>
        cfFetch<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
    delete: <T>(path: string) => cfFetch<T>(path, { method: "DELETE" }),
};

// ─── Account resolution ───────────────────────────────────────────────────────

// Keyed by token so concurrent users don't share each other's account ID.
const _accountIdCache = new Map<string, string>();

export async function getAccountId(): Promise<string> {
    const token = getToken();
    const cached = _accountIdCache.get(token);
    if (cached) return cached;

    const envId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (envId) {
        _accountIdCache.set(token, envId);
        return envId;
    }

    const accounts = await cfClient.get<CFAccount[]>("/accounts?per_page=10");
    if (!Array.isArray(accounts) || accounts.length === 0) {
        throw new Error("No Cloudflare accounts found. Check your API token permissions.");
    }
    if (accounts.length > 1) {
        throw new Error(
            `Multiple Cloudflare accounts found (${accounts.map((a) => `${a.name} (${a.id})`).join(", ")}). ` +
            `Set CLOUDFLARE_ACCOUNT_ID to specify which one.`,
        );
    }

    _accountIdCache.set(token, accounts[0].id);
    return accounts[0].id;
}
