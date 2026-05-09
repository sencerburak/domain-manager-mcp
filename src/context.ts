import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
    /** Cloudflare API token extracted from the Authorization header. */
    cfToken: string | undefined;
}

/**
 * AsyncLocalStorage that holds per-request context.
 * Populated by the HTTP handler in index.ts before each request is processed.
 * Read by cloudflare/client.ts getToken() so every tool call uses the
 * caller's own token rather than a shared server-level env var.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();
