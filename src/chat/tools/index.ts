import type { ToolProgressCallback } from "./types.js"
import { kbToolDefs, executeKbTool } from "./kb-tools.js"
import { scanProjectDef, executeScanProject } from "./scan-project.js"
import { browserToolDefs, executeBrowserTool } from "./browser-tools.js"
import { urlFetchDef, executeUrlFetch } from "./url-fetch.js"
import { gitCloneDef, executeGitClone } from "./git-clone.js"
import { readFileDef, executeReadFile, grepSearchDef, executeGrepSearch } from "./file-search.js"
import { runScriptDef, executeRunScript } from "./run-script.js"
import { kbResearchDef, executeKbResearch } from "./research.js"

export type { OpenAITool, ToolProgressCallback } from "./types.js"

export const toolDefinitions = [
  ...kbToolDefs,
  scanProjectDef,
  ...browserToolDefs,
  urlFetchDef,
  gitCloneDef,
  readFileDef,
  grepSearchDef,
  runScriptDef,
  kbResearchDef,
]

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  onProgress?: ToolProgressCallback,
): Promise<string> {
  const kbNames = new Set(["kb_search", "kb_read", "kb_list", "kb_write", "kb_outline"])
  if (kbNames.has(name)) return executeKbTool(name, args)

  if (name === "scan_project") return executeScanProject(args)

  const browserNames = new Set(["browser_scrape", "browser_map", "browser_crawl"])
  if (browserNames.has(name)) return executeBrowserTool(name, args)

  if (name === "url_fetch") return executeUrlFetch(args)
  if (name === "git_clone") return executeGitClone(args)
  if (name === "read_file") return executeReadFile(args)
  if (name === "grep_search") return executeGrepSearch(args)
  if (name === "run_script") return executeRunScript(args)
  if (name === "kb_research") return executeKbResearch(args, onProgress)

  return `Unknown tool: ${name}`
}
