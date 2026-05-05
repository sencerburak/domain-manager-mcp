#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Read tools
import * as checkDomain from "./tools/read/check_domain.js";
import * as searchDomains from "./tools/read/search_domains.js";
import * as listDomains from "./tools/read/list_domains.js";
import * as getDomain from "./tools/read/get_domain.js";
import * as getDnsRecords from "./tools/read/get_dns_records.js";
import * as getTldPricing from "./tools/read/get_tld_pricing.js";
import * as batchCheckDomains from "./tools/read/batch_check_domains.js";

// Write tools
import * as registerDomain from "./tools/write/register_domain.js";
import * as renewDomain from "./tools/write/renew_domain.js";
import * as updateDomainSettings from "./tools/write/update_domain_settings.js";
import * as createDnsRecord from "./tools/write/create_dns_record.js";
import * as updateDnsRecord from "./tools/write/update_dns_record.js";
import * as deleteDnsRecord from "./tools/write/delete_dns_record.js";

const server = new McpServer({
    name: "domain-manager",
    version: "1.0.0",
});

// Register all read tools
for (const tool of [checkDomain, searchDomains, listDomains, getDomain, getDnsRecords, getTldPricing, batchCheckDomains]) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, tool.handler);
}

// Register all write tools
for (const tool of [registerDomain, renewDomain, updateDomainSettings, createDnsRecord, updateDnsRecord, deleteDnsRecord]) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, tool.handler);
}

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Server runs until process exit
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
