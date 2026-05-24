import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { mcpStats } from "../../statistics/index.js"

export function wrapServerWithStats(server: McpServer): McpServer {
  const origTool = server.tool.bind(server)
  const wrappedTool = (...args: Parameters<typeof server.tool>) => {
    const last = args[args.length - 1]
    if (typeof last === "function") {
      const toolName = typeof args[0] === "string" ? args[0] : "unknown"
      args[args.length - 1] = async function (this: unknown, ...innerArgs: unknown[]) {
        const t0 = Date.now()
        try {
          const result = await (last as (...a: unknown[]) => Promise<unknown>)(...innerArgs)
          mcpStats.recordToolCall(toolName, {}, Date.now() - t0, false)
          return result
        } catch (err) {
          mcpStats.recordToolCall(toolName, {}, Date.now() - t0, true)
          throw err
        }
      } as typeof last
    }
    return origTool(...args)
  }
  server.tool = wrappedTool as typeof server.tool
  return server
}
