import { getRegistrarDomain } from "./src/cloudflare/registrar.js";

// Test with a few domains that should NOT be owned
const testDomains = [
    "axiom.com",         // Well-known brand
    "nexus.com",         // Well-known brand  
    "example.com",       // IANA reserved
    "test-notowned.com", // Unlikely to be owned
];

console.log("Testing getRegistrarDomain with known domains that should NOT be owned:");
console.log("API Token:", process.env.CLOUDFLARE_API_TOKEN ? "SET" : "NOT SET");
console.log("Account ID:", process.env.CLOUDFLARE_ACCOUNT_ID || "(will auto-detect)");
console.log("---\n");

for (const domain of testDomains) {
    try {
        const result = await getRegistrarDomain(domain);
        console.log(`${domain}:`);
        console.log(`  Result:`, result);
        console.log(`  Truthy?:`, result ? "YES ⚠️ (BUG)" : "NO (correct)");
        console.log();
    } catch (e) {
        console.log(`${domain}:`);
        console.log(`  Error:`, e instanceof Error ? e.message : String(e));
        console.log();
    }
}
