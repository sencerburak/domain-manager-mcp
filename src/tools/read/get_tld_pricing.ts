import { z } from "zod";
import { getTLDPolicies } from "../../cloudflare/registrar.js";
import { textContent } from "../../types.js";

export const name = "get_tld_pricing";
export const description =
    "Get Cloudflare Registrar pricing for TLDs. Shows registration and renewal fees, grace period, and max years. Use this before registering a domain to confirm pricing.";

export const inputSchema = z.object({
    tlds: z
        .array(z.string().min(2).max(24))
        .min(1)
        .max(20)
        .default(["com", "net", "org", "app", "dev", "ai", "xyz", "me"])
        .describe("TLDs to get pricing for (without dot), e.g. ['com', 'io', 'app']"),
});

export async function handler(args: z.infer<typeof inputSchema>) {
    const tlds = args.tlds.map((t) => t.toLowerCase().replace(/^\./, ""));

    // Query TLD policies directly from CF Registrar API (no dummy domain needed)
    const policies = await getTLDPolicies(tlds);

    const lines: string[] = [
        `## Cloudflare Registrar Pricing (${policies.length} TLD${policies.length === 1 ? "" : "s"})\n`,
        `${"TLD".padEnd(12)} ${"Register".padEnd(12)} ${"Renew".padEnd(12)} ${"Max Yrs".padEnd(10)} Grace (days)`,
        "-".repeat(60),
    ];

    for (const policy of policies.sort((a, b) => a.tld.localeCompare(b.tld))) {
        if (policy.supported) {
            const reg = `$${policy.registration_fee}`;
            const renew = `$${policy.renewal_fee}`;
            const maxYears = `${policy.max_registration_years}`;
            const grace = `${policy.grace_period}`;
            lines.push(
                `${"." + policy.tld.padEnd(11)} ${reg.padEnd(12)} ${renew.padEnd(12)} ${maxYears.padEnd(10)} ${grace}`,
            );
        } else {
            lines.push(`${"." + policy.tld.padEnd(11)} ${"❌ unsupported".padEnd(12)} - - -`);
        }
    }

    // Show TLDs that weren't in policies (may be unsupported or API didn't return them)
    const policySet = new Set(policies.map((p) => p.tld.toLowerCase()));
    const missing = tlds.filter((t) => !policySet.has(t.toLowerCase()));
    if (missing.length > 0) {
        lines.push("");
        lines.push("**Not found in Registrar:**");
        for (const tld of missing) {
            lines.push(`- .${tld} (may be unsupported or require dashboard registration)`);
        }
    }

    const supported = policies.filter((p) => p.supported).length;
    lines.push(`\n*${supported}/${policies.length} TLDs supported via Cloudflare Registrar API*`);

    return textContent(lines.join("\n"));
}
