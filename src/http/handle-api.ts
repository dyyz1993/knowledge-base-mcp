import { IncomingMessage, ServerResponse } from "node:http"
import { writeDoc, readDoc, searchDocs, listDocs, getOutline, listAllOutlines, searchDocsSemantic, searchDocsCombined, getAllKeywords, listRecentDocs, resolveMiss, rebuildAllVectors, deleteDoc } from "../storage/index.js"
import { searchStats, llmStats, embeddingStats, mcpStats } from "../statistics/index.js"
import { getStorageStats } from "../search/vector-store.js"
import { kbAskPipeline } from "../search/kb-ask-pipeline.js"
import { getMcpWebSearch } from "../search/mcp-web-search.js"
import { WebSearchPrimeSource } from "../search/source-web-search-prime.js"
import { createXBrowserSources } from "../search/source-xbrowser.js"
import { LlmDirectSource } from "../search/source-llm-direct.js"
import { SearchPipeline } from "../search/search-pipeline.js"
import { getConfiguredModels } from "../chat/api-models.js"
import { loadConfig, saveConfig } from "../config.js"
import type { AppConfig } from "../config.js"
import type { SearchSource } from "../search/types.js"
import { readBody, json, parseBody, validateUrl, htmlToPlainText } from "./helpers.js"
import { renderRecentHtml } from "./render.js"

export async function handleRestAPI(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === "/api/docs" && req.method === "GET") {
    json(res, listDocs())
    return
  }
  if (url.pathname === "/api/docs/recent" && req.method === "GET") {
    const hours = parseInt(url.searchParams.get("hours") || "24", 10) || 24
    const since = url.searchParams.get("since") ? (parseInt(url.searchParams.get("since")!, 10) || undefined) : undefined
    const limit = parseInt(url.searchParams.get("limit") || "50", 10) || 50
    const include_content = url.searchParams.get("include_content") === "true"
    const format = url.searchParams.get("format") || "json"
    const results = listRecentDocs({ hours, since, limit, include_content })
    if (format === "html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(renderRecentHtml(results, hours))
    } else {
      json(res, results)
    }
    return
  }
  if (url.pathname.startsWith("/api/doc/") && req.method === "GET") {
    const id = url.pathname.slice("/api/doc/".length)
    json(res, readDoc(id, true))
    return
  }
  if (url.pathname.startsWith("/api/doc/") && req.method === "DELETE") {
    const id = url.pathname.slice("/api/doc/".length)
    const ok = deleteDoc(id)
    json(res, { deleted: ok, id })
    return
  }
  if (url.pathname === "/api/docs" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    json(res, readDoc(body.id, true))
    return
  }
  if (url.pathname === "/api/docs/write" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const { title, content, intent, project_description } = body
    if (!title || !content || typeof title !== "string" || typeof content !== "string") {
      json(res, { error: "title and content are required strings" }, 400)
      return
    }
    const tags = Array.isArray(body.tags) ? body.tags : []
    const keywords = Array.isArray(body.keywords) ? body.keywords : []
    const doc = writeDoc(
      {
        title,
        tags,
        keywords,
        intent: intent || "",
        project_description: project_description || "",
        source_project: "",
        source_worktree: "",
      },
      content,
    )
    json(res, doc)
    return
  }
  if (url.pathname === "/api/search/semantic" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    try {
      const results = await searchDocsSemantic(body.query, body.limit || 10)
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
      json(res, { error: e instanceof Error ? e.message : String(e) }, 500)
    }
    return
  }
  if (url.pathname === "/api/search" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    if (body.query) {
      try {
        json(res, await searchDocsCombined(body.query, body.keywords, body.tags, body.limit))
      } catch (e) {
        console.error("[search] Combined search failed, falling back:", e instanceof Error ? e.message : String(e))
        json(res, searchDocs(body.query, body.keywords, body.tags, body.limit))
      }
      return
    }
    json(res, searchDocs(body.query, body.keywords, body.tags, body.limit))
    return
  }
  if (url.pathname === "/api/outlines" && req.method === "GET") {
    json(res, listAllOutlines())
    return
  }
  if (url.pathname === "/api/outline" && req.method === "GET") {
    const project = url.searchParams.get("project")
    if (!project) { json(res, { error: "project required" }, 400); return }
    json(res, getOutline(project))
    return
  }
  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = loadConfig()
    let storage
    try { storage = getStorageStats() } catch { storage = null }
    json(res, {
      ...config,
      storage,
      embedding: {
        ...config.embedding,
        apiKey: config.embedding.apiKey ? config.embedding.apiKey.slice(0, 8) + "..." : "",
      },
    })
    return
  }
  if (url.pathname === "/api/stats" && req.method === "GET") {
    const search = searchStats.getStats()
    const llm = llmStats.getStats()
    const embedding = embeddingStats.getStats()
    const mcp = mcpStats.getStats()
    json(res, {
      summary: {
        totalSearchQueries: search.totalQueries,
        totalSearchResults: search.totalResults,
        activeSources: Object.keys(search.sources).length,
        totalLLMCalls: Object.values(llm.models).reduce((sum, m) => sum + m.count, 0),
      },
      searchSources: Object.values(search.sources).map(s => ({
        name: s.name,
        calls: s.count,
        totalTime: s.totalTime,
        avgTime: s.avgTime,
        avgResults: s.count > 0 ? (s.totalResults || 0) / s.count : 0,
        errors: s.errors,
        lastCalled: s.lastCalledAt,
      })),
      llmUsage: Object.values(llm.models).map(m => ({
        name: m.model,
        calls: m.count,
        totalTokens: m.totalTokens,
        avgTokens: m.count > 0 ? m.totalTokens / m.count : 0,
        totalCost: m.totalCost,
        avgTime: m.avgTime,
        lastCalled: m.lastCalledAt,
      })),
      embedding: {
        calls: embedding.count,
        totalTokens: embedding.totalTokens,
        avgTime: embedding.avgTime,
        lastCalled: embedding.lastCalledAt,
      },
      mcpTools: Object.values(mcp.tools).map(t => ({
        name: t.name,
        calls: t.count,
        totalTime: t.totalTime,
        avgTime: t.avgTime,
        errors: t.errors,
        lastCalled: t.lastCalledAt,
      })),
    })
    return
  }
  if (url.pathname === "/api/stats/reset" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const type = body.type || "all"
    if (type === "search" || type === "all") searchStats.reset()
    if (type === "llm" || type === "all") llmStats.reset()
    if (type === "embedding" || type === "all") embeddingStats.reset()
    if (type === "mcp" || type === "all") mcpStats.reset()
    json(res, { success: true })
    return
  }
  if (url.pathname === "/api/stats/usage" && req.method === "GET") {
    const config = loadConfig()
    const results: Record<string, { service: string; status: string; used?: number; limit?: number; remaining?: number; balance?: string; plan?: string; rateLimit?: number; note?: string; raw?: unknown }> = {}

    const fetchWithProxy = async (url: string, headers: Record<string, string>) => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10000)
        const resp = await fetch(url, { headers, signal: controller.signal })
        clearTimeout(timer)
        return await resp.text()
      } catch {
        return ""
      }
    }

    if (config.webSearch.tavilyApiKey) {
      try {
        const raw = await fetchWithProxy("https://api.tavily.com/usage", { "Authorization": `Bearer ${config.webSearch.tavilyApiKey}` })
        const parsed = JSON.parse(raw)
        const keyUsage = parsed.key || parsed
        const accountUsage = parsed.account || {}
        const limit = keyUsage.limit ?? accountUsage.plan_limit
        const used = keyUsage.usage ?? accountUsage.plan_usage ?? 0
        results.tavily = {
          service: "Tavily",
          status: "ok",
          used,
          limit,
          remaining: limit != null ? limit - used : undefined,
          plan: accountUsage.current_plan,
          raw: parsed,
        }
      } catch {
        results.tavily = { service: "Tavily", status: "error" }
      }
    }

    if (config.webSearch.serperApiKey) {
      try {
        const raw = await fetchWithProxy("https://google.serper.dev/account", { "X-API-KEY": config.webSearch.serperApiKey })
        const parsed = JSON.parse(raw)
        results.serper = {
          service: "Serper.dev",
          status: "ok",
          remaining: parsed.balance,
          rateLimit: parsed.rateLimit,
          raw: parsed,
        }
      } catch {
        results.serper = { service: "Serper.dev", status: "error" }
      }
    }

    if (config.embedding.apiKey) {
      try {
        const raw = await fetchWithProxy("https://api.siliconflow.cn/v1/user/info", { "Authorization": `Bearer ${config.embedding.apiKey}` })
        const parsed = JSON.parse(raw)
        results.siliconflow = {
          service: "SiliconFlow (Embedding)",
          status: "ok",
          balance: parsed.data?.totalBalance ?? parsed.totalBalance ?? parsed.data?.balance,
          raw: parsed,
        }
      } catch {
        results.siliconflow = { service: "SiliconFlow (Embedding)", status: "error" }
      }
    }

    results.zhipu = { service: "Zhipu/BigModel (Web Search)", status: "unsupported", note: "No public billing API" }

    json(res, { updatedAt: Date.now(), services: results })
    return
  }
  if (url.pathname === "/api/config" && req.method === "PUT") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const current = loadConfig()
    const update = body

    if (update.embedding?.apiKey?.endsWith("...")) {
      update.embedding.apiKey = current.embedding.apiKey
    }

    const merged: AppConfig = {
      embedding: { ...current.embedding, ...update.embedding },
      search: {
        ...current.search,
        ...update.search,
        weights: { ...current.search.weights, ...update.search?.weights },
      },
      skills: { ...current.skills, ...update.skills },
      browser: { ...current.browser, ...update.browser },
      webSearch: { ...current.webSearch, ...update.webSearch },
      searchPipeline: {
        ...current.searchPipeline,
        ...update.searchPipeline,
        sources: {
          ...current.searchPipeline?.sources,
          ...update.searchPipeline?.sources,
          webSearchPrime: { ...current.searchPipeline?.sources?.webSearchPrime, ...update.searchPipeline?.sources?.webSearchPrime },
          xbrowser: { ...current.searchPipeline?.sources?.xbrowser, ...update.searchPipeline?.sources?.xbrowser },
          llmDirect: { ...current.searchPipeline?.sources?.llmDirect, ...update.searchPipeline?.sources?.llmDirect },
          plugin: { ...current.searchPipeline?.sources?.plugin, ...update.searchPipeline?.sources?.plugin },
        },
      },
      storage: { ...current.storage, ...update.storage },
      timeouts: { ...current.timeouts, ...update.timeouts },
      askPipeline: { ...current.askPipeline, ...update.askPipeline },
    }

    saveConfig(merged)
    json(res, { success: true })
    return
  }
  if (url.pathname === "/api/embedding/test" && req.method === "POST") {
    try {
      const config = loadConfig()
      if (!config.embedding?.enabled) {
        json(res, { success: false, error: "Embedding not enabled" })
        return
      }
      const { getEmbedding } = await import("../search/embedding.js")
      const testVec = await getEmbedding("test")
      if (testVec && testVec.length > 0) {
        json(res, { success: true, dimensions: testVec.length })
      } else {
        json(res, { success: false, error: "Embedding returned empty vector" })
      }
    } catch (e) {
      json(res, { success: false, error: e instanceof Error ? e.message : String(e) })
    }
    return
  }
  if (url.pathname === "/api/embedding/reindex" && req.method === "POST") {
    try {
      const docs = listDocs()
      if (docs.length === 0) {
        json(res, { success: true, message: "No documents to reindex" })
        return
      }
      const count = await rebuildAllVectors(docs)
      json(res, { success: true, message: `Reindexed ${count} documents` })
    } catch (e: unknown) {
      json(res, { success: false, error: e instanceof Error ? e.message : String(e) }, 500)
    }
    return
  }
  if (url.pathname === "/api/kb-ask" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const query = body.query
    if (!query || typeof query !== "string") {
      json(res, { error: "Missing or invalid 'query' field" }, 400)
      return
    }
    const maxWebResults = typeof body.max_web_results === "number" ? body.max_web_results : 3
    try {
      const result = await kbAskPipeline(query, maxWebResults)
      json(res, result)
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      json(res, { from_kb: false, hint: "查询失败", error: errorMessage })
    }
    return
  }
  if (url.pathname === "/api/web-read" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const targetUrl = body.url
    if (!targetUrl) {
      json(res, { error: "Missing 'url' field" }, 400)
      return
    }
    const { safe, reason } = validateUrl(targetUrl)
    if (!safe) { json(res, { error: `URL blocked: ${reason}` }, 400); return }
    const webSearch = getMcpWebSearch()
    if (webSearch) {
      const result = await webSearch.readUrl(targetUrl)
      if (result) {
        json(res, { success: true, ...result })
        return
      }
    }
    const config = loadConfig()
    try {
      const resp = await fetch(targetUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
        signal: AbortSignal.timeout(config.timeouts.webReadMs),
      })
      const html = await resp.text()
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1].trim() : targetUrl
      const bodyContent = htmlToPlainText(html).slice(0, 20000)
      if (bodyContent.length > 50) {
        json(res, { success: true, title, content: bodyContent, url: targetUrl })
        return
      }
      json(res, { error: "Failed to extract content" }, 500)
    } catch (e: unknown) {
      json(res, { error: `Failed to read URL: ${e instanceof Error ? e.message : "unknown"}` }, 500)
    }
    return
  }
  if (url.pathname === "/api/kb-ingest" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const { url: docUrl, title, content, tags, keywords } = body
    if (!title || !content) {
      json(res, { error: "Missing required fields: title, content" }, 400)
      return
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
    return
  }
  if (url.pathname === "/api/ask-search" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const query = body.query
    if (!query) { json(res, { error: "Missing 'query'" }, 400); return }

    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      json(res, { error: "Search pipeline not enabled" }, 503); return
    }

    const modelSpec = body.model as { provider: string; id: string } | undefined
    let resolvedModel: { baseUrl: string; apiKey: string; id: string } | null = null
    if (modelSpec) {
      const configured = getConfiguredModels()
      const found = configured.find(m => m.provider === modelSpec.provider && m.id === modelSpec.id)
      if (found?.apiKey && found?.baseUrl) {
        resolvedModel = { baseUrl: found.baseUrl, apiKey: found.apiKey, id: found.id }
      }
    }

    const sources: SearchSource[] = []

    if (config.searchPipeline.sources.webSearchPrime.enabled && config.webSearch.apiKey) {
      sources.push(new WebSearchPrimeSource())
    }

    if (config.searchPipeline.sources.xbrowser.enabled) {
      const engines = config.searchPipeline.sources.xbrowser.engines?.length
        ? config.searchPipeline.sources.xbrowser.engines
        : [config.searchPipeline.sources.xbrowser.engine]
      const xbrowserSources = createXBrowserSources({
        enabled: true,
        engine: config.searchPipeline.sources.xbrowser.engine,
        cdpEndpoint: config.searchPipeline.sources.xbrowser.cdpEndpoint,
        headless: config.searchPipeline.sources.xbrowser.headless,
        timeout: config.searchPipeline.sources.xbrowser.timeout,
      }, engines)
      sources.push(...xbrowserSources)
    }

    {
      const src = new LlmDirectSource()
      if (src.available()) sources.push(src)
    }

    const pipeline = new SearchPipeline(sources)
    const result = await pipeline.search(query, config.searchPipeline.maxResults || 10)
    json(res, result)
    return
  }

  if (url.pathname === "/api/ask-deep-read" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const targetUrl = body.url
    if (!targetUrl) { json(res, { error: "Missing 'url'" }, 400); return }

    const { safe, reason } = validateUrl(targetUrl)
    if (!safe) { json(res, { error: `URL blocked: ${reason}` }, 400); return }

    const config = loadConfig()
    const xbrowserEnabled = config.searchPipeline?.sources?.xbrowser?.enabled

    if (xbrowserEnabled) {
      const { XBrowserCLI } = await import("../search/xbrowser-cli.js")
      const cli = new XBrowserCLI({
        enabled: true,
        engine: config.searchPipeline.sources.xbrowser.engine,
        cdpEndpoint: config.searchPipeline.sources.xbrowser.cdpEndpoint,
        headless: config.searchPipeline.sources.xbrowser.headless,
        timeout: config.searchPipeline.sources.xbrowser.timeout,
      })
      const result = await cli.scrape(targetUrl)
      if (result) {
        json(res, { success: true, ...result })
        return
      }
    }

    const webSearch = getMcpWebSearch()
    if (webSearch) {
      const result = await webSearch.readUrl(targetUrl)
      if (result) {
        json(res, { success: true, ...result })
        return
      }
    }

    try {
      const resp = await fetch(targetUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
        signal: AbortSignal.timeout(config.timeouts.webReadMs),
      })
      const html = await resp.text()
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1].trim() : targetUrl
      const bodyContent = htmlToPlainText(html).slice(0, 20000)
      if (bodyContent.length > 50) {
        json(res, { success: true, title, content: bodyContent, url: targetUrl })
        return
      }
    } catch (e) { console.warn("[index]", e instanceof Error ? e.message : String(e)) }

    json(res, { error: "No deep read source available" }, 503)
    return
  }

  if (url.pathname === "/api/ask-summarize" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const { query, content, title, url: sourceUrl, tags, keywords } = body
    if (!content || !title) { json(res, { error: "Missing 'content' or 'title'" }, 400); return }

    const autoKeywords = keywords?.length
      ? keywords
      : title.split(/[\s\-_—–,，、：:]+/).filter((w: string) => w.length >= 2)
    const finalTags = tags?.length ? tags : ["reference", "web-ingested"]

    const doc = writeDoc(
      {
        title,
        tags: finalTags,
        keywords: autoKeywords,
        intent: `Research result: ${title.slice(0, 60)}`,
        project_description: "ask-research",
        project_path: "",
        source_project: "",
        source_worktree: "",
        related_projects: [],
        related_files: sourceUrl ? [sourceUrl] : [],
      },
      content,
    )
    if (query) resolveMiss(query)
    if (sourceUrl) resolveMiss(sourceUrl)
    json(res, { saved: true, id: doc.id, title: doc.title })
    return
  }

  if (url.pathname === "/api/ask-research" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const query = body.query as string | undefined
    if (!query) { json(res, { error: "Missing 'query'" }, 400); return }

    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      json(res, { error: "Search pipeline not enabled" }, 503)
      return
    }

    const start = Date.now()

    const modelSpec = body.model as { provider: string; id: string } | undefined
    let resolvedModel: { baseUrl: string; apiKey: string; id: string } | null = null
    if (modelSpec) {
      const configured = getConfiguredModels()
      const found = configured.find(m => m.provider === modelSpec.provider && m.id === modelSpec.id)
      if (found?.apiKey && found?.baseUrl) {
        resolvedModel = { baseUrl: found.baseUrl, apiKey: found.apiKey, id: found.id }
      }
    }

    const sources: SearchSource[] = []

    if (config.searchPipeline.sources.webSearchPrime.enabled && config.webSearch.apiKey) {
      sources.push(new WebSearchPrimeSource())
    }

    if (config.searchPipeline.sources.xbrowser.enabled) {
      const engines = config.searchPipeline.sources.xbrowser.engines?.length
        ? config.searchPipeline.sources.xbrowser.engines
        : [config.searchPipeline.sources.xbrowser.engine]
      const xbrowserSources = createXBrowserSources({
        enabled: true,
        engine: config.searchPipeline.sources.xbrowser.engine,
        cdpEndpoint: config.searchPipeline.sources.xbrowser.cdpEndpoint,
        headless: config.searchPipeline.sources.xbrowser.headless,
        timeout: config.searchPipeline.sources.xbrowser.timeout,
      }, engines)
      sources.push(...xbrowserSources)
    }

    {
      const src = new LlmDirectSource()
      if (src.available()) sources.push(src)
    }

    const pipeline = new SearchPipeline(sources)
    const searchResult = await pipeline.search(query, 30)

    if (searchResult.results.length === 0) {
      json(res, {
        query,
        searchResults: [],
        evaluatedCount: 0,
        deepReadCount: 0,
        summary: "未找到相关搜索结果",
        sources: [],
        durationMs: Date.now() - start,
        sourceTimings: searchResult.sourceTimings,
        phaseLog: ["searching: 0 results"],
      })
      return
    }

    const phaseLog: string[] = [`searching: ${searchResult.results.length} results from ${searchResult.totalSources} sources`]

    if (!resolvedModel) {
      json(res, {
        query,
        searchResults: searchResult.results,
        evaluatedCount: 0,
        deepReadCount: 0,
        summary: null,
        sources: [],
        durationMs: Date.now() - start,
        sourceTimings: searchResult.sourceTimings,
        phaseLog: [...phaseLog, "evaluating: skipped (no model configured)"],
      })
      return
    }

    const { callLlm } = await import("../search/llm-caller.js")
    const llmConfig = { baseUrl: resolvedModel.baseUrl, apiKey: resolvedModel.apiKey, model: resolvedModel.id }

    const allResults = searchResult.results.slice(0, 30)
    const resultListText = allResults
      .map((r, i) => `[${i}] ${r.title}\n    URL: ${r.url}\n    Snippet: ${r.snippet.slice(0, 200)}`)
      .join("\n\n")

    const evalPrompt = `Given the search query: "${query}"

Here are the search results:

${resultListText}

Pick the top 5-8 most relevant and authoritative results for answering this query. Consider:
- Direct relevance to the query
- Source authority (official docs > GitHub > blog > platform)
- Content depth (detailed content > shallow snippets)

Return ONLY a JSON array of the selected indices, e.g. [0, 3, 5, 8, 12]. No other text.`

    let selectedIndices: number[] = []
    try {
      const evalResponse = await callLlm(llmConfig, [
        { role: "system", content: "You are a research assistant. You select the most relevant search results. Respond ONLY with a JSON array of indices." },
        { role: "user", content: evalPrompt },
      ], 0.1, 200)

      const match = evalResponse.match(/\[[\d\s,]+\]/)
      if (match) {
        selectedIndices = JSON.parse(match[0])
          .filter((idx: number) => typeof idx === "number" && idx >= 0 && idx < allResults.length)
          .slice(0, 8)
      }
      if (selectedIndices.length === 0) {
        selectedIndices = allResults.slice(0, 5).map((_: unknown, i: number) => i)
      }
    } catch {
      selectedIndices = allResults.slice(0, 5).map((_: unknown, i: number) => i)
    }

    phaseLog.push(`evaluating: LLM selected ${selectedIndices.length} URLs`)

    const selectedUrls = selectedIndices.map(i => searchResult.results[i]).filter(Boolean)

    interface DeepReadItem { url: string; title: string; content: string }
    const deepReadResults: DeepReadItem[] = []
    const urlsToRead = selectedUrls.slice(0, 5)

    const readPromises = urlsToRead.map(async (item) => {
      try {
        if (config.searchPipeline?.sources?.xbrowser?.enabled) {
          const { XBrowserCLI } = await import("../search/xbrowser-cli.js")
          const cli = new XBrowserCLI({
            enabled: true,
            engine: config.searchPipeline.sources.xbrowser.engine,
            cdpEndpoint: config.searchPipeline.sources.xbrowser.cdpEndpoint,
            headless: config.searchPipeline.sources.xbrowser.headless,
            timeout: config.searchPipeline.sources.xbrowser.timeout,
          })
          const scraped = await cli.scrape(item.url)
          if (scraped?.content) {
            return { url: item.url, title: scraped.title || item.title, content: scraped.content }
          }
        }

        const webSearch = getMcpWebSearch()
        if (webSearch) {
          const readResult = await webSearch.readUrl(item.url)
          if (readResult?.content) {
            return { url: item.url, title: readResult.title || item.title, content: readResult.content }
          }
        }

        const resp = await fetch(item.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
          signal: AbortSignal.timeout(config.timeouts.deepReadMs),
        })
        const html = await resp.text()
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
        const title = titleMatch ? titleMatch[1].trim() : item.title
        const bodyContent = htmlToPlainText(html).slice(0, 20000)
        if (bodyContent.length > 50) {
          return { url: item.url, title, content: bodyContent }
        }
        return null
      } catch {
        return null
      }
    })

    const readResults = await Promise.all(readPromises)
    for (const r of readResults) {
      if (r) deepReadResults.push(r)
    }

    phaseLog.push(`deep-reading: ${deepReadResults.length}/${urlsToRead.length} URLs read successfully`)

    if (deepReadResults.length === 0) {
      json(res, {
        query,
        searchResults: searchResult.results,
        evaluatedCount: selectedUrls.length,
        deepReadCount: 0,
        summary: null,
        sources: [],
        durationMs: Date.now() - start,
        sourceTimings: searchResult.sourceTimings,
        phaseLog: [...phaseLog, "summarizing: skipped (no content to summarize)"],
      })
      return
    }

    const contentSections = deepReadResults
      .map((r, i) => `## [${i + 1}] ${r.title} (${r.url})\n\n${r.content.slice(0, 4000)}`)
      .join("\n\n---\n\n")

    const summaryPrompt = `Based on the following deep-read content about "${query}":

${contentSections}

Synthesize a comprehensive answer that:
1. Directly answers the query
2. Includes specific code examples or API references if found
3. Cites the sources with [1], [2] etc.
4. Is well-structured with headers and bullet points

Answer in the same language as the query.`

    let summary = ""
    let summaryFallback = false
    try {
      summary = await callLlm(llmConfig, [
        { role: "system", content: "You are a research assistant. Provide comprehensive, well-structured answers with citations." },
        { role: "user", content: summaryPrompt },
      ], 0.3, 3000)

      if (!summary || summary.trim().length < 50) {
        phaseLog.push(`summarizing: LLM returned empty/short response (${summary.length} chars), using fallback`)
        summaryFallback = true
        summary = deepReadResults
          .map((r, i) => `### [${i + 1}] ${r.title}\n来源: ${r.url}\n\n${r.content.slice(0, 800).split("\n").filter(l => l.trim().length > 20).slice(0, 5).join("\n")}`)
          .join("\n\n---\n\n")
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      phaseLog.push(`summarizing: LLM call failed (${errMsg}), using fallback`)
      summaryFallback = true
      summary = deepReadResults
        .map((r, i) => `### [${i + 1}] ${r.title}\n来源: ${r.url}\n\n${r.content.slice(0, 800).split("\n").filter(l => l.trim().length > 20).slice(0, 5).join("\n")}`)
        .join("\n\n---\n\n")
    }

    phaseLog.push(`summarizing: done${summaryFallback ? " (fallback)" : ""}`)

    const finalSources = deepReadResults.map(r => ({ title: r.title, url: r.url }))

    json(res, {
      query,
      searchResults: searchResult.results,
      evaluatedCount: selectedUrls.length,
      deepReadCount: deepReadResults.length,
      summary,
      summaryFallback,
      sources: finalSources,
      durationMs: Date.now() - start,
      sourceTimings: searchResult.sourceTimings,
      phaseLog,
    })
    return
  }

  if (url.pathname === "/api/agent-research" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const query = body.query as string | undefined
    if (!query) { json(res, { error: "Missing 'query'" }, 400); return }

    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      json(res, { error: "Search pipeline not enabled" }, 503)
      return
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    })

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 10000)

    const abortCtrl = new AbortController()
    res.on("close", () => {
      clearInterval(heartbeat)
      abortCtrl.abort()
    })

    try {
      const { ResearchAgent } = await import("../research/research-agent.js")
      const agent = new ResearchAgent(
        {
          query,
          mode: body.mode || "standard",
          model: body.model,
          smallModel: body.smallModel,
        },
        (progress) => {
          sendSSE("step", progress)
        },
      )

      const result = await agent.run()
      sendSSE("done", result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      sendSSE("error", { error: msg })
    } finally {
      clearInterval(heartbeat)
      res.end()
    }

    return
  }

  if (url.pathname === "/api/research-evolve" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      json(res, { error: "Search pipeline not enabled" }, 503)
      return
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    })

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 10000)

    const abortCtrl = new AbortController()
    res.on("close", () => {
      clearInterval(heartbeat)
      abortCtrl.abort()
    })

    try {
      const { ResearchEvolutionAgent } = await import("../research/evolution/orchestrator.js")
      const agent = new ResearchEvolutionAgent(
        {
          maxCycles: body.maxCycles || 3,
          serverUrl: body.serverUrl || `http://localhost:${process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : "19877"}`,
          model: body.model || { provider: "zhipuai", id: "glm-5.1" },
          smallModel: body.smallModel || { provider: "zhipuai", id: "glm-4-flash" },
          targetMetrics: body.targetMetrics || undefined,
        },
        undefined,
        (msg: string) => {
          sendSSE("log", { msg, timestamp: Date.now() })
        },
      )

      const cycles = await agent.run()
      sendSSE("done", { cycles, report: agent.getReport() })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      sendSSE("error", { error: msg })
    } finally {
      clearInterval(heartbeat)
      res.end()
    }

    return
  }

  if (url.pathname === "/api/ask-work-key" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return
    const { query, results } = body
    if (!query || !results || !Array.isArray(results)) {
      json(res, { error: "Missing 'query' or 'results'" }, 400)
      return
    }

    const topResults = results.slice(0, 5)
    const outline = topResults.map((r: { title: string; sourceType: string }) =>
      `- ${r.title} [${r.sourceType}]`
    ).join("\n")

    const keyPoints = topResults.map((r: { snippet: string }) =>
      r.snippet.slice(0, 200)
    ).filter((s: string) => s.length > 20)

    const sources = topResults.map((r: { title: string; url: string; source: string; qualityScore: number }) => ({
      title: r.title,
      url: r.url,
      source: r.source,
      qualityScore: r.qualityScore,
    }))

    let content = `# ${query}\n\n## 大纲\n${outline}\n\n## 关键信息\n${keyPoints.map((p: string, i: number) => `${i + 1}. ${p}`).join("\n")}\n\n## 来源\n${sources.map((s: { title: string; url: string; source: string; qualityScore: number }) => `- [${s.title}](${s.url}) (${s.source}, 评分: ${s.qualityScore})`).join("\n")}`

    const modelSpec = body.model as { provider: string; id: string } | undefined
    if (modelSpec) {
      const configured = getConfiguredModels()
      const found = configured.find(m => m.provider === modelSpec.provider && m.id === modelSpec.id)
      if (found?.apiKey && found?.baseUrl) {
        try {
          const llmResp = await fetch(`${found.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${found.apiKey}`,
            },
            body: JSON.stringify({
              model: found.id,
              messages: [
                { role: "system", content: "你是一个研究助手。根据提供的搜索结果，生成一份结构化的研究报告。报告包含：1. 概述（2-3句话）2. 核心要点（3-5条）3. 技术细节 4. 参考来源。使用 Markdown 格式，中文回答。" },
                { role: "user", content: `查询: ${query}\n\n搜索结果:\n${topResults.map((r: { title: string; snippet: string; url: string }) => `- ${r.title}: ${r.snippet}\n  ${r.url}`).join("\n")}` },
              ],
              max_tokens: 2000,
              temperature: 0.3,
            }),
            signal: AbortSignal.timeout(30000),
          })
          const llmData = await llmResp.json() as Record<string, unknown>
          const choices = llmData.choices as Array<{ message: { content: string } }> | undefined
          const llmContent = choices?.[0]?.message?.content
          if (llmContent) {
            content = `# ${query}\n\n${llmContent}\n\n## 来源\n${sources.map((s: { title: string; url: string; source: string; qualityScore: number }) => `- [${s.title}](${s.url}) (${s.source}, 评分: ${s.qualityScore})`).join("\n")}`
          }
        } catch (e) { console.warn("[index]", e instanceof Error ? e.message : String(e)) }
      }
    }

    const autoKeywords = query.split(/[\s\-_—–,，、：:]+/).filter((w: string) => w.length >= 2)

    const doc = writeDoc(
      {
        title: `Work Key: ${query}`,
        tags: ["reference", "web-ingested", "work-key"],
        keywords: autoKeywords,
        intent: `Research work key: ${query}`,
        project_description: "ask-research",
        project_path: "",
        source_project: "",
        source_worktree: "",
        related_projects: [],
        related_files: sources.filter((s: { url: string }) => s.url).map((s: { url: string }) => s.url),
      },
      content,
    )
    resolveMiss(query)

    json(res, {
      saved: true,
      id: doc.id,
      title: doc.title,
      outline,
      keyPoints,
      sources,
      content,
    })
    return
  }

  // ── Site Ingestion (SSE) ──
  if (url.pathname === "/api/ingest-site" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return

    const { url: siteUrl, tags, projectName } = body
    const maxPages = Math.min(Math.max(parseInt(body.maxPages) || 10, 1), 100)
    const concurrency = Math.min(Math.max(parseInt(body.concurrency) || 2, 1), 10)
    if (!siteUrl) { json(res, { error: "url is required" }, 400); return }

    // SSE response
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, 10000)

    const abortCtrl = new AbortController()
    res.on("close", () => {
      clearInterval(heartbeat)
      abortCtrl.abort()
    })

    import("../ingest/site-ingester.js").then(({ ingestSite }) => {
      return ingestSite(
        {
          url: siteUrl,
          maxPages: maxPages || 100,
          concurrency: concurrency || 5,
          tags: tags || [],
          projectName: projectName || undefined,
        },
        (progress) => send("progress", progress),
      )
    }).then((result) => {
      send("done", result)
      clearInterval(heartbeat)
      res.end()
    }).catch((err) => {
      send("error", { error: err instanceof Error ? err.message : String(err) })
      clearInterval(heartbeat)
      res.end()
    })

    return
  }

  json(res, { error: "Not Found" }, 404)
}
