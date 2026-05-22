import { IncomingMessage, ServerResponse } from "node:http"
import { buildSearchPipelineSources } from "../search/kb-ask-pipeline.js"
import { getMcpWebSearch } from "../search/mcp-web-search.js"
import { LlmDirectSource } from "../search/source-llm-direct.js"
import { SearchPipeline } from "../search/search-pipeline.js"
import { getConfiguredModels } from "../chat/api-models.js"
import { loadConfig } from "../config.js"
import { json, parseBody, extractHtmlContent, getApiUserAgent } from "./helpers.js"

export async function handleAskResearchRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== "/api/ask-research" || req.method !== "POST") return false

  const body = (await parseBody(req, res)) as Record<string, any>
  if (body === null) return true
  const query = body.query as string | undefined
  if (!query) { json(res, { error: "Missing 'query'" }, 400); return true }

  const config = loadConfig()
  if (!config.searchPipeline?.enabled) {
    json(res, { error: "Search pipeline not enabled" }, 503)
    return true
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

  const sources = buildSearchPipelineSources()
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
    return true
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
    return true
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
        headers: { "User-Agent": getApiUserAgent() },
        signal: AbortSignal.timeout(config.timeouts.deepReadMs),
      })
      const html = await resp.text()
      const { title, content } = extractHtmlContent(html, item.title)
      if (content.length > 50) {
        return { url: item.url, title, content }
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
    return true
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
  return true
}
