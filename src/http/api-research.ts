import { IncomingMessage, ServerResponse } from "node:http"
import { writeDoc, resolveMiss } from "../storage/index.js"
import { getMcpWebSearch } from "../search/mcp-web-search.js"
import { getConfiguredModels } from "../chat/api-models.js"
import { loadConfig } from "../config.js"
import { json, parseBody, validateUrl, extractHtmlContent, getApiUserAgent, setupSSE } from "./helpers.js"
export async function handleResearchRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === "/api/ask-deep-read" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const targetUrl = body.url
    if (!targetUrl) { json(res, { error: "Missing 'url'" }, 400); return true }

    const { safe, reason } = validateUrl(targetUrl)
    if (!safe) { json(res, { error: `URL blocked: ${reason}` }, 400); return true }

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
    } catch (e) { console.warn("[index]", e instanceof Error ? e.message : String(e)) }
    json(res, { error: "No deep read source available" }, 503)
    return true
  }

  if (url.pathname === "/api/ask-summarize" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const { query, content, title, url: sourceUrl, tags, keywords } = body
    if (!content || !title) { json(res, { error: "Missing 'content' or 'title'" }, 400); return true }

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
      json(res, { error: "Missing 'query' or 'results'" }, 400)
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
    return true
  }

  if (url.pathname === "/api/agent-research" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const query = body.query as string | undefined
    if (!query) { json(res, { error: "Missing 'query'" }, 400); return true }

    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      json(res, { error: "Search pipeline not enabled" }, 503)
      return true
    }

    const { send, cleanup } = setupSSE(res)

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
          send("step", progress)
        },
      )

      const result = await agent.run()
      send("done", result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      send("error", { error: msg })
    } finally {
      cleanup()
      res.end()
    }

    return true
  }

  if (url.pathname === "/api/research-evolve" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      json(res, { error: "Search pipeline not enabled" }, 503)
      return true
    }

    const { send, cleanup } = setupSSE(res)

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
    if (!siteUrl) { json(res, { error: "url is required" }, 400); return true }

    const { send, cleanup } = setupSSE(res)

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
