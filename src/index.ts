#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { join } from "node:path"
let _version = "2.23.0"
try { _version = JSON.parse(readFileSync(join(import.meta.dir, "package.json"), "utf-8")).version } catch { /* version unavailable */ }
const VERSION = _version
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { initDb, closeDb } from "./search/vector-store.js"
import { registerTools } from "./mcp/register-tools.js"
import { startHttp } from "./http/start.js"
import { flushStats } from "./statistics/index.js"
import { createLogger } from "./utils/logger.js"


const logger = createLogger("index")
const noMcp = process.argv.includes("--no-mcp")

const mcp = noMcp ? null : (() => {
  const server = new McpServer({ name: "knowledge-base", version: "1.0.0" })
  registerTools(server)
  return server
})()

// Graceful shutdown
let httpServer: ReturnType<typeof startHttp> | null = null

async function shutdown(signal: string) {
  logger.info(`\n[shutdown] Received ${signal}, shutting down gracefully...`)
  try {
    await flushStats()
    closeDb()
    if (httpServer) {
      httpServer.close()
      logger.info("HTTP server closed")
    }
  } catch (e) {
    logger.error("Error during shutdown:", e)
  }
  process.exit(0)
}

process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

async function main() {
  const cliCommands = new Set(["search", "search-token", "search-tfidf", "search-semantic", "list", "recent", "read", "write", "delete", "ingest-url", "ingest-repo", "research", "ask", "outline", "stale", "suggest", "keywords", "stats", "version"])
  const firstArg = process.argv[2]
  if (firstArg === "--help" || firstArg === "-h" || cliCommands.has(firstArg)) {
    await import("./cli/index.js")
    return
  }

  initDb()

  const mode = process.argv.includes("--http") || process.argv.includes("--web") ? "http" : "stdio"

  if (mode === "stdio") {
    if (noMcp) {
      logger.error("Error: --no-mcp cannot be used with stdio mode (MCP is required for stdio)")
      process.exit(1)
    }
    const transport = new StdioServerTransport()
    await mcp!.connect(transport)
    logger.error("Knowledge Base MCP running on stdio")
  } else {
    const portIdx = process.argv.indexOf("--port")
    const portStr = portIdx !== -1 ? process.argv[portIdx + 1] : undefined
    const port = portStr && /^\d+$/.test(portStr) ? parseInt(portStr, 10) : 19877
    if (port < 1 || port > 65535) {
      logger.error(`Invalid port: ${portStr}`)
      process.exit(1)
    }
    httpServer = startHttp(port, noMcp)
  }
}

main().catch(console.error)
