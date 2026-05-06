#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";

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

const readTools = [checkDomain, searchDomains, listDomains, getDomain, getDnsRecords, getTldPricing, batchCheckDomains];
const writeTools = [registerDomain, renewDomain, updateDomainSettings, createDnsRecord, updateDnsRecord, deleteDnsRecord];

function createMcpServer() {
    const server = new McpServer({ name: "domain-manager", version: "1.8.0" });
    for (const tool of readTools) {
        server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, tool.handler);
    }
    for (const tool of writeTools) {
        server.registerTool(tool.name, { description: tool.description, inputSchema: tool.inputSchema }, tool.handler);
    }
    return server;
}

async function main() {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : null;

    if (port) {
        // HTTP sidecar mode: stateless, shared by all agentbox sessions on the Docker network.
        // opencode connects as "remote" type MCP pointing to http://mcp-domain-manager:{port}/mcp
        //
        // IMPORTANT: StreamableHTTPServerTransport in stateless mode (sessionIdGenerator: undefined)
        // cannot be reused across requests — the SDK throws on the second call.
        // Each request must get its own fresh McpServer + transport pair.
        const httpServer = http.createServer(async (req, res) => {
            if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
                res.writeHead(405).end();
                return;
            }
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
            const server = createMcpServer();
            await server.connect(transport);

            let body: unknown;
            if (req.method === "POST") {
                let data = "";
                req.on("data", (chunk) => { data += chunk; });
                await new Promise<void>((resolve) => req.on("end", resolve));
                try { body = JSON.parse(data); } catch { body = null; }
            }
            try {
                await transport.handleRequest(req, res, body);
            } finally {
                await server.close().catch(() => { });
            }
        });

        httpServer.listen(port, "0.0.0.0", () => {
            process.stderr.write(`domain-manager MCP server (HTTP) listening on :${port}\n`);
        });

        // Keep running until killed
        await new Promise(() => { });
    } else {
        // stdio mode — local binary (existing behaviour)
        const transport = new StdioServerTransport();
        const server = createMcpServer();
        await server.connect(transport);
    }
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});
