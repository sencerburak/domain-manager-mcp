/** Cloudflare API v4 envelope */
export interface CFResponse<T> {
    success: boolean;
    result: T;
    errors: CFError[];
    messages: CFMessage[];
    result_info?: CFResultInfo;
}

export interface CFError {
    code: number;
    message: string;
}

export interface CFMessage {
    code: number;
    message: string;
}

export interface CFResultInfo {
    count: number;
    page: number;
    per_page: number;
    total_count: number;
}

// ─── Zones ────────────────────────────────────────────────────────────────────

export interface CFZone {
    id: string;
    name: string;
    status: "active" | "pending" | "initializing" | "moved" | "deleted" | "deactivated";
    paused: boolean;
    type: "full" | "partial" | "secondary";
    name_servers: string[];
    original_name_servers: string[];
    created_on: string;
    modified_on: string;
    plan: { name: string };
    account: { id: string; name: string };
}

// ─── DNS Records ──────────────────────────────────────────────────────────────

export type DNSRecordType = "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV" | "CAA" | "PTR";

export interface CFDNSRecord {
    id: string;
    zone_id: string;
    zone_name: string;
    name: string;
    type: DNSRecordType;
    content: string;
    proxiable: boolean;
    proxied: boolean;
    ttl: number;
    locked: boolean;
    meta: {
        auto_added: boolean;
        managed_by_apps: boolean;
        managed_by_argo_tunnel: boolean;
        source: string;
    };
    created_on: string;
    modified_on: string;
    priority?: number; // MX, SRV
}

export interface CreateDNSRecordParams {
    type: DNSRecordType;
    name: string;
    content: string;
    ttl?: number; // 1 = auto
    proxied?: boolean;
    priority?: number;
    comment?: string;
}

export interface UpdateDNSRecordParams {
    type?: DNSRecordType;
    name?: string;
    content?: string;
    ttl?: number;
    proxied?: boolean;
    priority?: number;
    comment?: string;
}

// ─── Registrar ────────────────────────────────────────────────────────────────

export interface CFRegistrarDomain {
    domain: string;
    available: boolean;
    supported_tld: boolean;
    can_register: boolean;
    registered_at: string | null;
    expires_at: string | null;
    updated_at: string | null;
    registrar: string | null;
    status: string[];
    auto_renew: boolean;
    privacy: boolean;
    locked: boolean;
    name_servers: string[];
    original_registrar: string | null;
    original_dnshost: string | null;
    original_name_servers: string[];
    fees: {
        registration_fee: string;
        renewal_fee: string;
        transfer_fee: string;
        redemption_fee: string;
    } | null;
    registrant_contact: CFContact | null;
    billing_contact: CFContact | null;
    tech_contact: CFContact | null;
    admin_contact: CFContact | null;
}

export interface CFContact {
    id: string;
    first_name: string;
    last_name: string;
    organization: string;
    address: string;
    address2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    phone: string;
    email: string;
    fax: string;
}

export interface CFTLDPolicy {
    tld: string;
    icann_fees: string;
    registration_fee: string;
    renewal_fee: string;
    transfer_fee: string;
    redemption_fee: string;
    grace_period: number; // days
    redemption_period: number; // days
    supported: boolean;
    privacy_supported: boolean;
    min_registration_years: number;
    max_registration_years: number;
}

export interface CFAccount {
    id: string;
    name: string;
    type: string;
}

// ─── CF domain availability check ──────────────────────────────────────────────

export type CFDomainCheckReason =
    | "extension_not_supported_via_api"
    | "extension_not_supported"
    | "extension_disallows_registration"
    | "domain_premium"
    | "domain_unavailable";

export interface CFDomainCheckResult {
    name: string;
    registrable: boolean;
    pricing?: {
        currency: string;
        registration_cost: string;
        renewal_cost: string;
    };
    reason?: CFDomainCheckReason;
    tier?: "standard" | "premium";
}

// ─── Tool result helpers ──────────────────────────────────────────────────────

export function textContent(text: string) {
    return { content: [{ type: "text" as const, text }] };
}

export function errorContent(message: string) {
    return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true as const };
}
