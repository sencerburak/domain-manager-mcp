import { z } from "zod";
import { getTLDPolicies } from "../../cloudflare/registrar.js";
import { getPorkbunPricing } from "../../porkbun/pricing.js";
import { textContent } from "../../types.js";

export const name = "get_tld_pricing";
export const description =
    "Get domain pricing for TLDs. Shows Cloudflare Registrar pricing (registration, renewal, grace period) and Porkbun pricing for comparison. Use this before registering a domain to compare costs across registrars.";

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

    // Fetch CF and Porkbun pricing in parallel
    const [policies, pbPricing] = await Promise.all([
        getTLDPolicies(tlds),
        getPorkbunPricing(tlds),
    ]);

    const policySet = new Set(policies.map((p) => p.tld.toLowerCase()));

    // TLDs with CF data
    const lines: string[] = [
        `## TLD Pricing Comparison (${tlds.length} TLD${tlds.length === 1 ? "" : "s"})\n`,
        `${"TLD".padEnd(10)} ${"CF Reg".padEnd(10)} ${"CF Renew".padEnd(11)} ${"PB Reg".padEnd(10)} ${"PB Renew".padEnd(10)} CF Grace`,
        "-".repeat(70),
    ];

    for (const tld of [...tlds].sort()) {
        const policy = policies.find((p) => p.tld.toLowerCase() === tld);
        const pb = pbPricing.get(tld);

        const cfReg = policy?.supported ? `$${policy.registration_fee}` : "—";
        const cfRenew = policy?.supported ? `$${policy.renewal_fee}` : "—";
        const cfGrace = policy?.supported ? `${policy.grace_period}d` : "—";
        const pbReg = pb ? `$${pb.registration}` : "—";
        const pbRenew = pb ? `$${pb.renewal}` : "—";

        lines.push(
            `${"." + tld.padEnd(9)} ${cfReg.padEnd(10)} ${cfRenew.padEnd(11)} ${pbReg.padEnd(10)} ${pbRenew.padEnd(10)} ${cfGrace}`,
        );
    }

    // TLDs missing from CF entirely (not returned by policy API)
    const missing = tlds.filter((t) => !policySet.has(t));
    if (missing.length > 0) {
        lines.push("");
        lines.push("**Not found in CF Registrar API** (shown with Porkbun pricing only):");
        for (const tld of missing) {
            const pb = pbPricing.get(tld);
            if (pb) {
                lines.push(`- .${tld}: Porkbun reg $${pb.registration}/yr, renew $${pb.renewal}/yr`);
            } else {
                lines.push(`- .${tld}: not available at Porkbun either`);
            }
        }
    }

    const cfSupported = policies.filter((p) => p.supported).length;
    const pbSupported = pbPricing.size;
    lines.push(`\n*CF: ${cfSupported}/${policies.length} TLDs supported · Porkbun: ${pbSupported}/${tlds.length} TLDs found*`);

    return textContent(lines.join("\n"));
}
