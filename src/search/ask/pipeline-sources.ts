import { loadConfig, type AppConfig } from "../../config"
import type { SearchSource } from "../types"
import { WebSearchPrimeSource } from "../source-web-search-prime"
import { TavilySource } from "../source-tavily"
import { SerperSource } from "../source-serper"
import { createXBrowserSources } from "../source-xbrowser"
import { AiSearchSource } from "../source-ai-search"
import { LlmDirectSource } from "../source-llm-direct"
import { SearchPipeline } from "../search-pipeline"
import type { SearchResult } from "../types"

export function buildSearchPipelineSources(overrideConfig?: AppConfig): SearchSource[] {
  const config = overrideConfig ?? loadConfig()
  const sources: SearchSource[] = []

  if (config.searchPipeline?.sources.webSearchPrime.enabled && config.webSearch.apiKey) {
    sources.push(new WebSearchPrimeSource())
  }
  if (config.webSearch.tavilyApiKey && config.searchPipeline?.sources.tavily?.enabled) {
    sources.push(new TavilySource())
  }
  if (config.webSearch.serperApiKey && config.searchPipeline?.sources.serper?.enabled) {
    sources.push(new SerperSource())
  }
  if (config.searchPipeline?.sources.xbrowser.enabled) {
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
  if (config.searchPipeline?.sources.aiSearch?.enabled) {
    sources.push(new AiSearchSource())
  }
  if (config.searchPipeline?.sources.llmDirect?.enabled && config.searchPipeline.sources.llmDirect.apiKey) {
    sources.push(new LlmDirectSource())
  }

  return sources
}

export async function searchViaPipeline(query: string, maxResults: number): Promise<SearchResult[]> {
  const sources = buildSearchPipelineSources()
  if (sources.length === 0) return []

  const pipeline = new SearchPipeline(sources)
  const optimizedQuery = optimizeQueryForSearchEngine(query)
  const result = await pipeline.search(optimizedQuery, maxResults)
  return result.results
}

function optimizeQueryForSearchEngine(query: string): string {
  const tokens = query.split(/\s+/).filter(w => w.length > 1)
  if (tokens.length >= 2 && !query.includes('"')) {
    return `"${query}" ${query}`
  }
  return query
}
