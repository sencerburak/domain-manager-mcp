import { z } from "zod";
import { checkDomainsBatch } from "../../cloudflare/registrar.js";
import { getPorkbunPricing } from "../../porkbun/pricing.js";
import { textContent } from "../../types.js";

export const name = "get_tld_pricing";
export const description =
    "Get domain pricing for TLDs. Shows Cloudflare Registrar pricing (registration, renewal, in your account's currency) and Porkbun pricing for comparison. Use this before registering a domain to compare costs across registrars.";

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

    // Use the domain-check endpoint (POST /registrar/domain-check) to get real
    // pricing from CF. The deprecated /registrar/tld-policies endpoint does not
    // exist in the public API. We probe with a long random-looking name that's
    // virtually certain to be available on every TLD — we only want the price,
    // not to actually register it.
    const sampleBase = "zz-price-probe-noreply";
    const sampleDomains = tlds.map((t) => `${sampleBase}.${t}`);

    // Fetch CF pricing and Porkbun pricing in parallel
    const [cfResults, pbPricing] = await Promise.all([
        checkDomainsBatch(sampleDomains),
        getPorkbunPricing(tlds),
    ]);

    // Build a map from TLD → CF check result
    const cfMap = new Map(cfResults.map((r) => {
        const tld = r.name.split(".").slice(1).join(".");
        return [tld, r];
    }));

    // Determine the display currency from the first result that has pricing
    const currency = [...cfMap.values()].find((r) => r.pricing)?.pricing?.currency ?? "USD";

    const lines: string[] = [
        `## TLD Pricing Comparison (${tlds.length} TLD${tlds.length === 1 ? "" : "s"}) · ${currency}\n`,
        `${"TLD".padEnd(10)} ${"CF Reg".padEnd(12)} ${"CF Renew".padEnd(12)} ${"PB Reg".padEnd(12)} PB Renew`,
        "-".repeat(60),
    ];

    const cfUnsupportedApi: string[] = [];
    const cfUnsupported: string[] = [];

    for (const tld of [...tlds].sort()) {
        const r = cfMap.get(tld);
        const pb = pbPricing.get(tld);

        let cfReg = "—";
        let cfRenew = "—";

        if (r?.registrable && r.pricing) {
            cfReg = `${r.pricing.registration_cost}`;
            cfRenew = `${r.pricing.renewal_cost}`;
        } else if (r?.reason === "extension_not_supported_via_api") {
            cfReg = "dashboard";
            cfRenew = "dashboard";
            cfUnsupportedApi.push(tld);
        } else if (r?.reason === "extension_not_supported") {
            cfUnsupportedApi.push(tld);
        } else if (!r) {
            cfUnsupported.push(tld);
        }

        const pbReg = pb ? `${pb.registration}` : "—";
        const pbRenew = pb ? `${pb.renewal}` : "—";

        lines.push(
            `${"." + tld.padEnd(9)} ${cfReg.padEnd(12)} ${cfRenew.padEnd(12)} ${pbReg.padEnd(12)} ${pbRenew}`,
        );
    }

    if (cfUnsupportedApi.length > 0) {
        lines.push(`\n*"dashboard" = supported by CF Registrar but not via API; register at dash.cloudflare.com*`);
    }
    if (cfUnsupported.length > 0) {
        lines.push(`\n*Not in CF Registrar: ${cfUnsupported.map((t) => "." + t).join(", ")}*`);
    }

    const cfSupported = cfResults.filter((r) => r.registrable || r.reason === "extension_not_supported_via_api").length;
    const pbSupported = pbPricing.size;
    lines.push(`\n*CF: ${cfSupported}/${tlds.length} TLDs · Porkbun: ${pbSupported}/${tlds.length} TLDs · Prices per year*`);

    return textContent(lines.join("\n"));
}
