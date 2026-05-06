# Domain-Manager-MCP Tool Audit

**Date:** 2026-05-06  
**Total Tools:** 13 (7 read, 6 write)  
**Overall Status:** ✅ GOOD — all tools functional, but some optimization opportunities

---

## READ TOOLS

### ✅ `list_domains` — CORE UTILITY
- **Purpose:** List all zones + registrar domains in account
- **Status:** Well-implemented
- **Input:** Optional filter (all/zones/registrar)
- **Output:** Formatted table with status, plan, expiry
- **Notes:** Good starting point for domain discovery

### ✅ `get_domain` — DETAILED VIEW
- **Purpose:** Get comprehensive details on a single domain
- **Status:** Well-implemented
- **Input:** Domain name + optional include_dns_summary flag
- **Output:** Zone info, registrar info, DNS record counts, nameservers
- **Notes:** Complements `list_domains` — use when you need deep details on one domain
- **Dependency:** Requires domain to exist in your CF account

### ✅ `check_domain` — DISCOVERY / AVAILABILITY
- **Purpose:** Check if a domain is owned, zoned, or available for registration
- **Status:** Well-implemented
- **Input:** Single domain name
- **Output:** Ownership status + availability + pricing if available
- **Use Case:** When you want to check if a domain is available to register or owned by you
- **Implementation:** Checks registrar first, then zones, then queries CF Registrar API for availability

### 🔶 `batch_check_domains` — MATRIX CHECKER
- **Purpose:** Check availability of multiple domain names × TLDs (matrix of results)
- **Status:** Functional but description could be clearer
- **Input:** `names` (domain bases), `tlds` (list of TLDs)
- **Output:** Formatted matrix with ownership + availability
- **Example:** `names: ['myapp', 'mysite']`, `tlds: ['com', 'io', 'dev']` checks 6 combinations
- **Note:** Different from `search_domains` — this takes full domain names, not keywords
- **Recent Fix:** Added defensive check for `registered_at == null` to prevent false "Your Domains" results

### 🟢 `search_domains` — KEYWORD SEARCH
- **Purpose:** Search for available domains by keyword across multiple TLDs
- **Status:** Well-implemented and distinct from batch_check
- **Input:** `keywords` (strings or array), `tlds` (optional, defaults to 10 popular TLDs), `available_only` flag
- **Output:** Formatted table grouped by keyword showing availability + pricing
- **Difference from batch_check:** Takes keyword/brand names and expands to matrix; includes owned zones check
- **Use Case:** "Find available domains for my startup name"
- **Implementation:** Pre-fetches user zones for instant "owned" status, then batch-checks availability

### ⚠️ `get_tld_pricing` — PRICING PROBE
- **Purpose:** Get Cloudflare Registrar registration/renewal pricing for TLDs
- **Status:** Functional but uses a **hacky workaround**
- **Input:** `tlds` array (defaults to 8 popular TLDs)
- **Output:** Table with TLD, support status, register cost, renewal cost
- **Implementation Issue:** Uses a **dummy domain** (`xyzpricingprobe98765.{tld}`) to probe pricing via `checkDomainsBatch`
  - **Problem:** If the dummy name is actually taken in some TLD, pricing may not return correctly
  - **Alternative:** Cloudflare has a `GET /registrar/tld-policies` endpoint that returns pricing directly without needing a dummy name
  - **Recommendation:** Refactor to use `getTLDPolicies` API directly instead of the dummy domain hack

### ✅ `get_dns_records` — DNS RECORD LISTING
- **Purpose:** List DNS records for a domain, with filtering
- **Status:** Well-implemented
- **Input:** Domain name, optional type filter, optional name filter
- **Output:** Formatted table grouped by record type, includes record IDs
- **Features:** Full record ID display (needed for update/delete), short ID display (first 8 chars)
- **Use Case:** Finding records to modify or delete

---

## WRITE TOOLS

### ✅ `register_domain` — NEW REGISTRATION
- **Purpose:** Register a new domain through Cloudflare Registrar
- **Status:** Well-implemented
- **Input:** Domain, auto_renew (default true), privacy (default false), years (1–10)
- **Output:** Confirmation with registration details, expiry, zone info
- **Safety:** Good confirmation output, includes pricing context
- **Prerequisite:** Domain should be checked as available first (best practice but not enforced)

### ✅ `renew_domain` — DOMAIN RENEWAL
- **Purpose:** Renew an existing CF Registrar domain
- **Status:** Well-implemented
- **Input:** Domain, years (1–10, default 1)
- **Output:** Confirmation with old/new expiry dates, auto-renew status
- **Safety:** Pre-checks domain is in CF Registrar before attempting renewal
- **Note:** Charges account immediately

### ✅ `update_domain_settings` — REGISTRAR SETTINGS
- **Purpose:** Update CF Registrar domain settings (auto-renew, lock, privacy)
- **Status:** Well-implemented
- **Input:** Domain + any combination of `auto_renew`, `locked`, `privacy`
- **Output:** Confirmation with before/after state
- **Safety:** Requires at least one setting to be provided; verifies domain exists in CF Registrar
- **Note:** Useful for preventing accidental transfers (lock), reducing renewal charges (disable auto-renew), protecting privacy

### ✅ `create_dns_record` — NEW DNS RECORD
- **Purpose:** Create a new DNS record in a zone
- **Status:** Well-implemented
- **Input:** Domain, type (A/AAAA/CNAME/MX/TXT/NS/SRV/CAA/PTR), name, content, ttl, proxied (optional), priority (optional)
- **Output:** Confirmation with record ID, type, name, content, TTL, proxy status
- **Features:** 
  - Auto-normalizes record name (@ → apex, www → www.domain.com, partial names auto-completed)
  - Supports Cloudflare proxy (CDN) for A/AAAA/CNAME
  - Auto-sets TTL to 1 when proxied
- **Safety:** Good confirmation message

### ✅ `update_dns_record` — DNS RECORD MODIFICATION
- **Purpose:** Update an existing DNS record
- **Status:** Well-implemented
- **Input:** Domain, record_id, + any fields to update (content, ttl, proxied, comment)
- **Output:** Confirmation with changes (before → after)
- **Features:** 
  - Finds existing record by full ID or first 8 characters
  - Only updates specified fields
  - Shows what changed
- **Safety:** Good error messaging if record not found

### ✅ `delete_dns_record` — DNS RECORD DELETION
- **Purpose:** Delete a DNS record
- **Status:** Well-implemented
- **Input:** Domain, record_id
- **Output:** Confirmation with record details (type, name, content, ID)
- **Safety:** Requires finding record first, shows full details before deletion
- **Warning:** No confirmation prompt (design choice — trust the user)

---

## TOOL DEPENDENCY MAP

```
┌─ Availability Checking
│  ├─ check_domain (single domain)
│  ├─ batch_check_domains (domain matrix)
│  └─ search_domains (keyword search)
│
├─ Domain Discovery
│  ├─ list_domains (all domains)
│  └─ get_domain (detailed view)
│
├─ Pricing
│  └─ get_tld_pricing (TLD costs)
│
├─ Registration
│  └─ register_domain (buy domain)
│
├─ Renewal / Settings
│  ├─ renew_domain (extend registration)
│  └─ update_domain_settings (auto-renew, lock, privacy)
│
└─ DNS Management
   ├─ get_dns_records (list records)
   ├─ create_dns_record (add record)
   ├─ update_dns_record (modify record)
   └─ delete_dns_record (remove record)
```

---

## ISSUES & RECOMMENDATIONS

### 🔴 **ISSUE 1: `get_tld_pricing` uses dummy domain hack**
**Severity:** Medium  
**Description:** Pricing is probed by sending a dummy domain through the domain-check API. If the dummy name is actually taken, pricing returns may be incomplete or incorrect.

**Recommendation:** Refactor to use the `getTLDPolicies` API directly (already imported in registrar.ts):
```typescript
const policies = await getTLDPolicies(tlds);
// Returns: tld, registration_fee, renewal_fee, grace_period, max_years, etc.
```

**Implementation:** ~20 line refactor, should be more reliable and faster

---

### 🟡 **ISSUE 2: No domain transfer functionality**
**Severity:** Low  
**Description:** Can register, renew, update settings, but cannot transfer a domain into CF Registrar or out.

**Recommendation:** Add two tools (if needed):
- `initiate_domain_transfer` — get auth code, initiate CF transfer
- `finalize_domain_transfer` — complete incoming transfer

**Current Workaround:** Manually via Cloudflare dashboard

---

### 🟡 **ISSUE 3: No nameserver management**
**Severity:** Low  
**Description:** Cannot manually set nameservers for a CF Registrar domain. The tool only reads them.

**Recommendation:** Add `update_nameservers` tool if this becomes a common request

**Current Workaround:** Manually via Cloudflare dashboard or API

---

### 🟡 **ISSUE 4: No contact information management**
**Severity:** Low  
**Description:** Cannot update domain registrant/admin/billing contacts.

**Recommendation:** Add `update_domain_contacts` tool if this becomes a common request

**Current Workaround:** Manually via Cloudflare dashboard

---

### ✅ **FIXED: "Your Domains" bug (Recent)**
**Status:** RESOLVED  
**Fix Commit:** `b486058`  
**What was fixed:** `getRegistrarDomain()` now validates that `registered_at != null` before returning; prevents empty objects from being treated as "owned"

---

## TOOL USAGE PATTERNS

### 🎯 **Pattern 1: Find & Register a Domain**
```
1. search_domains({ keywords: ['myapp'], tlds: ['com', 'io', 'dev'] })
2. get_tld_pricing({ tlds: ['com', 'io'] })
3. register_domain({ domain: 'myapp.com', auto_renew: true })
4. create_dns_record({ domain: 'myapp.com', type: 'A', name: '@', content: '192.0.2.1' })
```

### 🎯 **Pattern 2: Batch Check Multiple Competitors**
```
batch_check_domains({
  names: ['competitor1', 'competitor2', 'competitor3'],
  tlds: ['com', 'ai']
})
```

### 🎯 **Pattern 3: Manage DNS for Existing Domain**
```
1. get_dns_records({ domain: 'example.com' })
2. create_dns_record({ domain: 'example.com', type: 'CNAME', name: 'blog', content: 'example.wordpress.com' })
3. update_dns_record({ domain: 'example.com', record_id: 'abc123...', content: '192.0.2.2' })
4. delete_dns_record({ domain: 'example.com', record_id: 'old456...' })
```

---

## RECOMMENDED IMPROVEMENTS (Priority Order)

1. **HIGH:** Refactor `get_tld_pricing` to use `getTLDPolicies` API directly
2. **MEDIUM:** Add error recovery to `search_domains` if batch-check partially fails
3. **MEDIUM:** Add optional confirmation prompts for write operations (especially delete_dns_record)
4. **LOW:** Add `transfer_domain` tools if multi-registrar support is needed
5. **LOW:** Cache TLD policies in memory to avoid repeated API calls

---

## SUMMARY

| Category               | Status | Notes                                                      |
| ---------------------- | ------ | ---------------------------------------------------------- |
| **Core Functionality** | ✅      | All essential operations working                           |
| **Error Handling**     | ✅      | Good validation and error messages                         |
| **API Integration**    | ✅      | Proper Cloudflare API usage (except get_tld_pricing hack)  |
| **Documentation**      | ✅      | Descriptions are clear and actionable                      |
| **Security**           | ✅      | Write operations have good confirmation output             |
| **Performance**        | 🟡      | get_tld_pricing uses inefficient dummy-domain approach     |
| **Completeness**       | 🟡      | Missing: transfers, nameserver management, contact updates |

**Recommended Action:** Refactor `get_tld_pricing` → everything else is solid.
