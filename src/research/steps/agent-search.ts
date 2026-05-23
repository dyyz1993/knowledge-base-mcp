import type { SearchResult, SourceName, SourceType } from "../../search/types"

export interface SearchState {
  query: string
  mode: "quick" | "standard" | "deep"
  loopCount: number
  phaseLog: string[]
  progressLog: Array<{ step: string; status: string; output?: unknown }>
  collectedSearchResults: SearchResult[]
}

export async function executeSearch(state: SearchState): Promise<void> {
  const { loadConfig } = await import("../../config.js")
  const config = loadConfig()
  if (!config.searchPipeline?.enabled) {
    state.phaseLog.push("search: pipeline not enabled")
    return
  }

  const sources: import("../../search/types").SearchSource[] = []

  if (config.searchPipeline.sources.webSearchPrime.enabled && config.webSearch.apiKey) {
    const { WebSearchPrimeSource } = await import("../../search/source-web-search-prime.js")
    sources.push(new WebSearchPrimeSource())
  }

  if (config.searchPipeline.sources.xbrowser.enabled) {
    const { createXBrowserSources } = await import("../../search/source-xbrowser.js")
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

  if (config.searchPipeline.sources.tavily?.enabled && config.webSearch.tavilyApiKey) {
    const { TavilySource } = await import("../../search/source-tavily.js")
    sources.push(new TavilySource())
  }

  if (config.searchPipeline.sources.serper?.enabled && config.webSearch.serperApiKey) {
    const { SerperSource } = await import("../../search/source-serper.js")
    sources.push(new SerperSource())
  }

  if (config.searchPipeline.sources.aiSearch?.enabled) {
    const { AiSearchSource } = await import("../../search/source-ai-search.js")
    sources.push(new AiSearchSource())
  }

  if (sources.length === 0) {
    state.phaseLog.push("search: no sources available")
    return
  }

  const { SearchPipeline } = await import("../../search/search-pipeline.js")
  const pipeline = new SearchPipeline(sources, { fastTimeout: 10_000, slowTimeout: 60_000 })

  const analyzeOutput = state.progressLog.find(
    (p) => p.step === "analyze_query" && p.status === "done",
  )?.output as { subQueries?: string[] } | undefined

  let queries: string[]
  if (state.loopCount > 0 && state.phaseLog.some(l => l.includes("missing:"))) {
    const missingLine = [...state.phaseLog].reverse().find((l: string) => l.includes("missing:"))
    const missingTopics = missingLine
      ? missingLine.match(/missing: ([^\)]+)/)?.[1]?.split(", ").map((s: string) => s.trim()) || []
      : []
    queries = missingTopics.length > 0
      ? missingTopics.slice(0, 5).map((t: string) => `${state.query} ${t}`)
      : [state.query]
    if (missingTopics.length > 0) {
      state.phaseLog.push(`gap-driven search: targeting [${missingTopics.join(", ")}]`)
    }
  } else {
    queries = analyzeOutput?.subQueries?.length
      ? analyzeOutput.subQueries.slice(0, 5)
      : [state.query]
  }

  queries = queries.map(optimizeSearchQuery)

  const allResults: SearchResult[] = []
  const concurrency = Math.min(queries.length, 5)
  for (let qi = 0; qi < queries.length; qi += concurrency) {
    const batch = queries.slice(qi, qi + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (q) => {
        try {
          const result = await pipeline.search(q, 15)
          return result.results
        } catch (e) {
          state.phaseLog.push(`search failed for query: ${q}: ${e instanceof Error ? e.message : String(e)}`)
          return [] as SearchResult[]
        }
      }),
    )
    for (const results of batchResults) {
      allResults.push(...results)
    }
  }

  const { normalizeUrl } = await import("../../search/utils.js")
  const seen = new Set<string>()
  state.collectedSearchResults = allResults.filter((r) => {
    const key = normalizeUrl(r.url)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  state.phaseLog.push(`search: ${state.collectedSearchResults.length} results from ${queries.length} queries`)
}

function optimizeSearchQuery(query: string): string {
  const tokens = query.split(/\s+/).filter(w => w.length > 1)
  if (tokens.length >= 2 && !query.includes('"') && tokens.length <= 5) {
    return `"${query}" ${query}`
  }
  return query
}
