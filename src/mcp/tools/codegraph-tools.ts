import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { writeDoc } from "../../storage/index.js"
import { createLogger } from "../../utils/logger.js"
import { existsSync } from "node:fs"
import { basename } from "node:path"
import {
  runCodegraph,
  parseJsonSafe,
  buildOverviewMarkdown,
  buildModuleMarkdown,
  buildSymbolMarkdown,
  extractKeywords,
  extractRelatedFiles,
} from "../../tools/codegraph-shared.js"
import type {
  CodegraphStatusResult,
  CodegraphFileResult,
  CodegraphContextResult,
} from "../../tools/codegraph-shared.js"

const logger = createLogger("mcp:codegraph-tools")

function asStatus(data: unknown): CodegraphStatusResult {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as CodegraphStatusResult
  }
  return { raw: String(data) }
}

function asFileArray(data: unknown): CodegraphFileResult[] {
  if (Array.isArray(data)) return data as CodegraphFileResult[]
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const wrapped = (data as { files?: unknown }).files
    if (Array.isArray(wrapped)) return wrapped as CodegraphFileResult[]
  }
  return []
}

function asContext(data: unknown, fallback: string): CodegraphContextResult {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as CodegraphContextResult
  }
  return { raw: fallback, summary: fallback.slice(0, 500) }
}

export function registerCodegraphTools(server: McpServer) {
  server.tool(
    "kb_ingest_codegraph",
    "Analyze a project's code structure using the codegraph CLI and write structured summaries into the knowledge base as searchable documents.",
    {
      project_path: z.string().describe("Absolute path to the project to analyze"),
      scope: z.enum(["overview", "module", "symbol"]).default("overview").describe("Level of detail: overview, module, or symbol"),
      query: z.string().optional().describe("Specific query for codegraph context command (used with symbol scope)"),
      force_reindex: z.boolean().default(false).describe("Whether to re-run codegraph index before querying"),
    },
    async (args) => {
      const { project_path, scope, query, force_reindex } = args

      if (!existsSync(project_path)) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Project path does not exist", path: project_path }) }],
        }
      }

      const hasCodegraphDir = existsSync(`${project_path}/.codegraph`)

      try {
        if (force_reindex || !hasCodegraphDir) {
          const initResult = await runCodegraph(
            hasCodegraphDir ? [] : ["init", "-i"],
            project_path,
            60000,
          )
          if (!hasCodegraphDir && initResult.exitCode !== 0) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ error: "codegraph init failed", stderr: initResult.stderr, exitCode: initResult.exitCode }),
              }],
            }
          }

          if (force_reindex) {
            const indexResult = await runCodegraph(["index", "-f"], project_path, 60000)
            if (indexResult.exitCode !== 0) {
              logger.warn("codegraph index force-reindex had issues:", indexResult.stderr)
            }
          }
        }

        const projectName = basename(project_path)
        let markdown = ""
        let keywords: string[] = [projectName]
        let relatedFiles: string[] = []
        let statusData: CodegraphStatusResult

        if (scope === "overview") {
          const result = await runCodegraph(["status", "--json"], project_path, 30000)
          if (result.exitCode !== 0) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ error: "codegraph status failed", stderr: result.stderr, exitCode: result.exitCode }),
              }],
            }
          }
          statusData = asStatus(parseJsonSafe(result.stdout) || { raw: result.stdout })
          markdown = buildOverviewMarkdown(projectName, statusData)
          keywords = extractKeywords(projectName, statusData)
        } else if (scope === "module") {
          const [statusResult, filesResult] = await Promise.all([
            runCodegraph(["status", "--json"], project_path, 30000),
            runCodegraph(["files", "--json"], project_path, 30000),
          ])

          if (statusResult.exitCode !== 0) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ error: "codegraph status failed", stderr: statusResult.stderr }),
              }],
            }
          }

          statusData = asStatus(parseJsonSafe(statusResult.stdout) || { raw: statusResult.stdout })
          const filesData = asFileArray(parseJsonSafe(filesResult.stdout))

          markdown = buildModuleMarkdown(projectName, statusData, filesData)
          keywords = extractKeywords(projectName, statusData, filesData)
          relatedFiles = extractRelatedFiles(filesData)
        } else {
          const taskQuery = query || `${projectName} project overview`
          const result = await runCodegraph(
            ["context", taskQuery, "--format", "json"],
            project_path,
            30000,
          )
          if (result.exitCode !== 0) {
            const fallbackMd = result.stdout || result.stderr
            if (fallbackMd && !result.stdout.includes("Error")) {
              const doc = writeDoc(
                {
                  title: `CodeGraph: ${projectName} - symbol analysis`,
                  tags: ["code-index", "codegraph", "symbol", "auto-ingested"],
                  keywords: [projectName],
                  intent: `Code structure analysis (symbol) for ${projectName}`,
                  project_description: projectName,
                  project_path,
                  source_project: projectName,
                  related_files: [],
                },
                `# ${projectName} — Symbol Analysis: ${taskQuery}\n\n${fallbackMd}\n\n---\n> Auto-generated by kb_ingest_codegraph`,
              )
              return {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    saved: true,
                    id: doc.id,
                    title: doc.title,
                    scope: "symbol",
                    project_name: projectName,
                    hint: `Stored symbol analysis for ${projectName}`,
                  }, null, 2),
                }],
              }
            }
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ error: "codegraph context failed", stderr: result.stderr, exitCode: result.exitCode }),
              }],
            }
          }

          const contextData = asContext(parseJsonSafe(result.stdout), result.stdout)
          markdown = buildSymbolMarkdown(projectName, taskQuery, contextData)
          keywords = extractKeywords(projectName, contextData.stats || {} as CodegraphStatusResult)
          if (contextData.dependencies) {
            relatedFiles = contextData.dependencies
              .map(d => typeof d === "string" ? d : d.path || d.file || "")
              .filter(p => p.length > 0)
              .slice(0, 50)
          }
          if (contextData.symbols) {
            const symFiles = contextData.symbols
              .map(s => s.file || (typeof s.location !== "string" ? s.location?.file : "") || "")
              .filter(f => f.length > 0)
            relatedFiles = [...new Set([...relatedFiles, ...symFiles])].slice(0, 50)
          }
        }

        const doc = writeDoc(
          {
            title: `CodeGraph: ${projectName} - ${scope} analysis`,
            tags: ["code-index", "codegraph", scope, "auto-ingested"],
            keywords,
            intent: `Code structure analysis (${scope}) for ${projectName}`,
            project_description: projectName,
            project_path,
            source_project: projectName,
            related_files: relatedFiles,
          },
          markdown,
        )

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              saved: true,
              id: doc.id,
              title: doc.title,
              scope,
              project_name: projectName,
              keywords,
              related_files_count: relatedFiles.length,
              hint: `Stored ${scope} analysis for ${projectName}`,
            }, null, 2),
          }],
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes("timed out")) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "codegraph command timed out", detail: msg }),
            }],
          }
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "codegraph execution failed", detail: msg }),
          }],
        }
      }
    },
  )
}
