import type { CFResponse, CFAccount } from "../types.js";

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
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) throw new Error("CLOUDFLARE_API_TOKEN environment variable is required");
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

let _accountId: string | null = null;

export async function getAccountId(): Promise<string> {
    if (_accountId) return _accountId;

    const envId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (envId) {
        _accountId = envId;
        return _accountId;
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

    _accountId = accounts[0].id;
    return _accountId;
}
