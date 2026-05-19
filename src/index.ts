#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { join } from "node:path"
let _version = "2.23.0"
try { _version = JSON.parse(readFileSync(join(import.meta.dir, "package.json"), "utf-8")).version } catch { /* version unavailable */ }
const VERSION = _version
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { initDb } from "./search/vector-store.js"
import { registerTools } from "./mcp/register-tools.js"
import { startHttp } from "./http/start.js"

const noMcp = process.argv.includes("--no-mcp")

const mcp = noMcp ? null : (() => {
  const server = new McpServer({ name: "knowledge-base", version: "1.0.0" })
  registerTools(server)
  return server
})()

async function main() {
  initDb()

  const mode = process.argv.includes("--http") || process.argv.includes("--web") ? "http" : "stdio"

  if (mode === "stdio") {
    if (noMcp) {
      console.error("Error: --no-mcp cannot be used with stdio mode (MCP is required for stdio)")
      process.exit(1)
    }
    const transport = new StdioServerTransport()
    await mcp!.connect(transport)
    console.error("Knowledge Base MCP running on stdio")
  } else {
    const portIdx = process.argv.indexOf("--port")
    const port = portIdx !== -1 ? parseInt(process.argv[portIdx + 1]) : 19877
    startHttp(port, noMcp)
  }
}

main().catch(console.error)
