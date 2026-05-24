import { IncomingMessage, ServerResponse } from "node:http"
import { json, apiError, parseBody } from "./helpers.js"
import { existsSync } from "node:fs"
import { basename } from "node:path"
import { writeDoc } from "../storage/index.js"
import { createLogger } from "../utils/logger.js"
import {
  runCodegraph,
  parseJsonSafe,
  buildOverviewMarkdown,
  buildModuleMarkdown,
  buildSymbolMarkdown,
} from "../tools/codegraph-shared.js"
import type {
  CodegraphStatusResult,
  CodegraphFileResult,
  CodegraphContextResult,
} from "../tools/codegraph-shared.js"

const logger = createLogger("http:codegraph")

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

export async function handleCodegraphRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/codegraph/ingest" || req.method !== "POST") return false

  const body = (await parseBody(req, res)) as Record<string, string> | null
  if (body === null) return true

  const project_path = body.project_path
  const scope = body.scope || "overview"
  const query = body.query
  const force_reindex = body.force_reindex === "true"

  if (!project_path || typeof project_path !== "string") {
    apiError(res, 400, "MISSING_FIELD", "project_path is required")
    return true
  }

  if (!["overview", "module", "symbol"].includes(scope)) {
    apiError(res, 400, "INVALID_INPUT", "scope must be 'overview', 'module', or 'symbol'")
    return true
  }

  if (!existsSync(project_path)) {
    apiError(res, 400, "INVALID_PATH", "Project path does not exist", { path: project_path })
    return true
  }

  try {
    const hasCodegraphDir = existsSync(`${project_path}/.codegraph`)

    if (force_reindex || !hasCodegraphDir) {
      if (!hasCodegraphDir) {
        const initResult = await runCodegraph(["init", "-i"], project_path, 60000)
        if (initResult.exitCode !== 0) {
          apiError(res, 500, "INTERNAL_ERROR", "codegraph init failed", { stderr: initResult.stderr })
          return true
        }
      }
      if (force_reindex) {
        await runCodegraph(["index", "-f"], project_path, 60000)
      }
    }

    const projectName = basename(project_path)
    let markdown = ""
    let keywords: string[] = [projectName]
    let relatedFiles: string[] = []

    if (scope === "overview") {
      const result = await runCodegraph(["status", "--json"], project_path, 30000)
      if (result.exitCode !== 0) {
        apiError(res, 500, "INTERNAL_ERROR", "codegraph status failed", { stderr: result.stderr })
        return true
      }
      const statusData = asStatus(parseJsonSafe(result.stdout) || { raw: result.stdout })
      markdown = buildOverviewMarkdown(projectName, statusData)
      keywords = [projectName, ...(Array.isArray(statusData.stats?.languages) ? statusData.stats.languages : [])]
    } else if (scope === "module") {
      const [statusResult, filesResult] = await Promise.all([
        runCodegraph(["status", "--json"], project_path, 30000),
        runCodegraph(["files", "--json"], project_path, 30000),
      ])
      if (statusResult.exitCode !== 0) {
        apiError(res, 500, "INTERNAL_ERROR", "codegraph status failed", { stderr: statusResult.stderr })
        return true
      }
      const statusData = asStatus(parseJsonSafe(statusResult.stdout) || { raw: statusResult.stdout })
      const filesData = asFileArray(parseJsonSafe(filesResult.stdout))
      markdown = buildModuleMarkdown(projectName, statusData, filesData)
      relatedFiles = filesData
        .map(f => f.path || f.filePath || f.name || "")
        .filter(p => p)
        .slice(0, 50)
    } else {
      const taskQuery = query || `${projectName} project overview`
      const result = await runCodegraph(["context", taskQuery, "--format", "json"], project_path, 30000)
      if (result.exitCode !== 0) {
        apiError(res, 500, "INTERNAL_ERROR", "codegraph context failed", { stderr: result.stderr })
        return true
      }
      const contextData = asContext(parseJsonSafe(result.stdout), result.stdout)
      markdown = buildSymbolMarkdown(projectName, taskQuery, contextData)
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

    json(res, {
      saved: true,
      id: doc.id,
      title: doc.title,
      scope,
      project_name: projectName,
      keywords,
      related_files_count: relatedFiles.length,
    })
    return true
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.error("codegraph ingest error:", msg)
    apiError(res, 500, "INTERNAL_ERROR", "codegraph execution failed", { detail: msg })
    return true
  }
}
