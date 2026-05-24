import { IncomingMessage, ServerResponse } from "node:http"
import { searchDocs, searchDocsSemantic, searchDocsCombined, listDocs, rebuildAllVectors, writeDoc, resolveMiss } from "../storage/index.js"
import { kbAskPipeline, buildSearchPipelineSources } from "../search/kb-ask-pipeline.js"
import { getMcpWebSearch } from "../search/mcp-web-search.js"
import { LlmDirectSource } from "../search/source-llm-direct.js"
import { SearchPipeline } from "../search/search-pipeline.js"
import { getConfiguredModels } from "../chat/api-models.js"
import { loadConfig } from "../config.js"
import { json, apiError, validateUrl, extractHtmlContent, getApiUserAgent } from "./helpers.js"
import { semanticSearchSchema, searchSchema, kbAskSchema, askSearchSchema, webReadSchema, kbIngestSchema } from "./schemas.js"
import { parseBodyTyped } from "./validate.js"
import { createLogger } from "../utils/logger.js"

export async function handleSearchRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {

const logger = createLogger("http:api-search")
  if (url.pathname === "/api/search/semantic" && req.method === "POST") {
    const body = await parseBodyTyped(req, res, semanticSearchSchema)
    if (!body) return true
    try {
      const results = await searchDocsSemantic(body.query, body.limit)
      json(res, results.map(d => ({
        id: d.id,
        title: d.title,
        tags: d.tags,
        keywords: d.keywords,
        source_project: d.source_project,
        score: Math.round(d.score * 1000) / 1000,
        created_at: d.created_at,
      })))
    } catch (e: unknown) {
      json(res, { error: { code: "INTERNAL_ERROR", message: e instanceof Error ? e.message : String(e) } }, 500)
    }
    return true
  }
  if (url.pathname === "/api/search" && req.method === "POST") {
    const body = await parseBodyTyped(req, res, searchSchema)
    if (!body) return true
    if (body.query) {
      try {
        json(res, await searchDocsCombined(body.query, body.keywords, body.tags, body.limit))
      } catch (e) {
        logger.error("Combined search failed, falling back:", e instanceof Error ? e.message : String(e))
        json(res, searchDocs(body.query, body.keywords, body.tags, body.limit))
      }
      return true
    }
    json(res, searchDocs(body.query, body.keywords, body.tags, body.limit))
    return true
  }
  if (url.pathname === "/api/kb-ask" && req.method === "POST") {
    const body = await parseBodyTyped(req, res, kbAskSchema)
    if (!body) return true
    const query = body.query
    const maxWebResults = body.max_web_results
    try {
      const result = await kbAskPipeline(query, maxWebResults)
      json(res, result)
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      json(res, { from_kb: false, hint: "查询失败", error: errorMessage })
    }
    return true
  }
  if (url.pathname === "/api/ask-search" && req.method === "POST") {
    const body = await parseBodyTyped(req, res, askSearchSchema)
    if (!body) return true
    const query = body.query

    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      json(res, { error: "Search pipeline not enabled" }, 503); return true
    }

    const modelSpec = body.model
    let resolvedModel: { baseUrl: string; apiKey: string; id: string } | null = null
    if (modelSpec) {
      const configured = getConfiguredModels()
      const found = configured.find(m => m.provider === modelSpec.provider && m.id === modelSpec.id)
      if (found?.apiKey && found?.baseUrl) {
        resolvedModel = { baseUrl: found.baseUrl, apiKey: found.apiKey, id: found.id }
      }
    }

    const sources = buildSearchPipelineSources()
    {
      const src = new LlmDirectSource()
      if (src.available()) sources.push(src)
    }

    const pipeline = new SearchPipeline(sources)
    const result = await pipeline.search(query, config.searchPipeline.maxResults || 10)
    json(res, result)
    return true
  }
  if (url.pathname === "/api/web-read" && req.method === "POST") {
    const body = await parseBodyTyped(req, res, webReadSchema)
    if (!body) return true
    const targetUrl = body.url
    const { safe, reason } = validateUrl(targetUrl)
    if (!safe) { apiError(res, 400, "INVALID_INPUT", `URL blocked: ${reason}`); return true }
    const webSearch = getMcpWebSearch()
    if (webSearch) {
      const result = await webSearch.readUrl(targetUrl)
      if (result) {
        json(res, { success: true, ...result })
        return true
      }
    }
    const config = loadConfig()
    try {
      const resp = await fetch(targetUrl, {
        headers: { "User-Agent": getApiUserAgent() },
        signal: AbortSignal.timeout(config.timeouts.webReadMs),
      })
      const html = await resp.text()
      const { title, content } = extractHtmlContent(html, targetUrl)
      if (content.length > 50) {
        json(res, { success: true, title, content, url: targetUrl })
        return true
      }
      apiError(res, 500, "INTERNAL_ERROR", "Failed to extract content")
    } catch (e: unknown) {
      apiError(res, 500, "INTERNAL_ERROR", `Failed to read URL: ${e instanceof Error ? e.message : "unknown"}`)
    }
    return true
  }
  if (url.pathname === "/api/embedding/test" && req.method === "POST") {
    try {
      const config = loadConfig()
      if (!config.embedding?.enabled) {
        json(res, { success: false, error: "Embedding not enabled" })
        return true
      }
      const { embed } = await import("../search/embedding.js")
      const testVec = await embed("test")
      if (testVec && testVec.length > 0) {
        json(res, { success: true, dimensions: testVec.length })
      } else {
        json(res, { success: false, error: "Embedding returned empty vector" })
      }
    } catch (e) {
      json(res, { success: false, error: e instanceof Error ? e.message : String(e) })
    }
    return true
  }
  if (url.pathname === "/api/embedding/reindex" && req.method === "POST") {
    try {
      const docs = listDocs()
      if (docs.length === 0) {
        json(res, { success: true, message: "No documents to reindex" })
        return true
      }
      const count = await rebuildAllVectors(docs)
      json(res, { success: true, message: `Reindexed ${count} documents` })
    } catch (e: unknown) {
      json(res, { success: false, error: e instanceof Error ? e.message : String(e) }, 500)
    }
    return true
  }
  if (url.pathname === "/api/kb-ingest" && req.method === "POST") {
    const body = await parseBodyTyped(req, res, kbIngestSchema)
    if (!body) return true
    const { url: docUrl, title, content, tags, keywords } = body
      if (!title || !content) {
        apiError(res, 400, "MISSING_FIELD", "Missing required fields: title, content")
      return true
    }
    const autoKeywords = keywords?.length
      ? keywords
      : title.split(/[\s\-_\-—–,，、：:]+/).filter((w: string) => w.length >= 2)
    const finalTags = tags?.length ? tags : ["reference", "web-ingested"]
    const doc = writeDoc(
      {
        title,
        tags: finalTags,
        keywords: autoKeywords,
        intent: `Web-ingested content: ${title.slice(0, 60)}`,
        project_description: "web-ingest",
        project_path: "",
        source_project: "",
        source_worktree: "",
        related_projects: [],
        related_files: docUrl ? [docUrl] : [],
      },
      content,
    )
    resolveMiss(title)
    if (docUrl) resolveMiss(docUrl)
    json(res, { saved: true, id: doc.id, title: doc.title, miss_resolved: true })
    return true
  }
  return false
}
