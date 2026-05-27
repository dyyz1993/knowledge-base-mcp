import { IncomingMessage, ServerResponse } from "node:http"
import crypto from "node:crypto"
import { writeDoc, resolveMiss } from "../storage/index.js"
import { getMcpWebSearch } from "../search/mcp-web-search.js"
import { getConfiguredModels } from "../chat/api-models.js"
import { loadConfig } from "../config.js"
import { json, apiError, parseBody, validateUrl, extractHtmlContent, getApiUserAgent, setupSSE } from "./helpers.js"
import { createResearchState, getResearchState, updateResearchProgress, completeResearch, failResearch } from "../research/research-state-store.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("http:api-research")

export async function handleResearchRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === "/api/ask-deep-read" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const targetUrl = body.url
    if (!targetUrl) { apiError(res, 400, "MISSING_FIELD", "Missing 'url'"); return true }

    const { safe, reason } = validateUrl(targetUrl)
    if (!safe) { apiError(res, 400, "INVALID_INPUT", `URL blocked: ${reason}`); return true }

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
        return true
      }
    }

    const webSearch = getMcpWebSearch()
    if (webSearch) {
      const result = await webSearch.readUrl(targetUrl)
      if (result) {
        json(res, { success: true, ...result })
        return true
      }
    }

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
    } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
    apiError(res, 503, "INTERNAL_ERROR", "No deep read source available")
    return true
  }

  if (url.pathname === "/api/ask-summarize" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const { query, content, title, url: sourceUrl, tags, keywords } = body
    if (!content || !title) { apiError(res, 400, "MISSING_FIELD", "Missing 'content' or 'title'"); return true }

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
    return true
  }

  if (url.pathname === "/api/ask-work-key" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const { query, results } = body
    if (!query || !results || !Array.isArray(results)) {
      apiError(res, 400, "MISSING_FIELD", "Missing 'query' or 'results'")
      return true
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
        } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
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
    return true
  }

  const agentResearchPrefix = "/api/agent-research/"

  if (url.pathname === agentResearchPrefix.slice(0, -1) && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const query = body.query as string | undefined
    if (!query) { apiError(res, 400, "MISSING_FIELD", "Missing 'query'"); return true }

    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      apiError(res, 503, "INTERNAL_ERROR", "Search pipeline not enabled")
      return true
    }

    const researchId = crypto.randomUUID()
    const mode = body.mode || "standard"
    createResearchState(researchId, query, mode)

    const { send, cleanup } = setupSSE(res, req.headers.origin)

    send("started", { researchId })

    try {
      const { ResearchAgent } = await import("../research/research-agent.js")
      const agent = new ResearchAgent(
        {
          query,
          mode,
          model: body.model,
          smallModel: body.smallModel,
        },
        (progress) => {
          updateResearchProgress(researchId, progress)
          send("step", progress)
        },
      )

      const result = await agent.run()
      completeResearch(researchId, result)
      send("done", result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failResearch(researchId, msg)
      send("error", { error: msg, researchId })
    } finally {
      cleanup()
      res.end()
    }

    return true
  }

  if (url.pathname.startsWith(agentResearchPrefix) && req.method === "GET") {
    const parts = url.pathname.slice(agentResearchPrefix.length).split("/")
    const researchId = parts[0]
    const subPath = parts[1]

    if (!researchId) {
      apiError(res, 400, "MISSING_FIELD", "Missing researchId in path")
      return true
    }

    const state = getResearchState(researchId)
    if (!state) {
      apiError(res, 404, "NOT_FOUND", `Research ${researchId} not found`)
      return true
    }

    if (subPath === "status") {
      json(res, {
        researchId: state.researchId,
        status: state.status,
        mode: state.mode,
        query: state.query,
        progress: state.progress,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      })
      return true
    }

    if (subPath === "result") {
      if (state.status === "running") {
        apiError(res, 409, "STILL_RUNNING", `Research ${researchId} is still running`)
        return true
      }
      if (state.status === "failed") {
        apiError(res, 500, "RESEARCH_FAILED", state.error || "Research failed")
        return true
      }
      if (!state.result) {
        apiError(res, 404, "NO_RESULT", `No result for research ${researchId}`)
        return true
      }
      json(res, state.result)
      return true
    }

    apiError(res, 400, "INVALID_PATH", "Use /status or /result sub-path")
    return true
  }

  if (url.pathname === "/api/research-evolve" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      apiError(res, 503, "INTERNAL_ERROR", "Search pipeline not enabled")
      return true
    }

    const { send, cleanup } = setupSSE(res, req.headers.origin)

    try {
      const { ResearchEvolutionAgent } = await import("../research/evolution/orchestrator.js")
      const agent = new ResearchEvolutionAgent(
        {
          maxCycles: body.maxCycles || 3,
          serverUrl: body.serverUrl || (() => { const i = process.argv.indexOf("--port"); return `http://localhost:${i >= 0 ? process.argv[i + 1] : "19877"}` })(),
          model: body.model || { provider: "zhipuai", id: "glm-5.1" },
          smallModel: body.smallModel || { provider: "zhipuai", id: "glm-4-flash" },
          targetMetrics: body.targetMetrics || undefined,
        },
        undefined,
        (msg: string) => {
          send("log", { msg, timestamp: Date.now() })
        },
      )

      const cycles = await agent.run()
      send("done", { cycles, report: agent.getReport() })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      send("error", { error: msg })
    } finally {
      cleanup()
      res.end()
    }

    return true
  }

  if (url.pathname === "/api/ingest-site" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true

    const { url: siteUrl, tags, projectName } = body
    const maxPages = Math.min(Math.max(parseInt(body.maxPages) || 10, 1), 100)
    const concurrency = Math.min(Math.max(parseInt(body.concurrency) || 2, 1), 10)
    if (!siteUrl) { apiError(res, 400, "MISSING_FIELD", "url is required"); return true }

     const { send, cleanup } = setupSSE(res, req.headers.origin)

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
      cleanup()
      res.end()
    }).catch((err) => {
      send("error", { error: err instanceof Error ? err.message : String(err) })
      cleanup()
      res.end()
    })

    return true
  }

  return false
}
