import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { wrapServerWithStats } from "./tools/tool-utils.js"
import { registerDocTools } from "./tools/doc-tools.js"
import { registerSearchTools } from "./tools/search-tools.js"
import { registerFileTools } from "./tools/file-tools.js"
import { registerResearchTools } from "./tools/research-tools.js"
import { registerCodegraphTools } from "./tools/codegraph-tools.js"

export function registerTools(server: McpServer) {
  wrapServerWithStats(server)
  registerDocTools(server)
  registerSearchTools(server)
  registerFileTools(server)
  registerResearchTools(server)
  registerCodegraphTools(server)
}
