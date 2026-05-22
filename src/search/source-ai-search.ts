import type { SearchSource, SearchResult } from "./types"
import { loadConfig } from "../config"
import { XBrowserCLI } from "./xbrowser-cli"
import type { XBrowserAIEngine } from "./xbrowser-cli"

export class AiSearchSource implements SearchSource {
  name = "ai-search" as const

  available(): boolean {
    const config = loadConfig()
    const aiConfig = config.searchPipeline.sources.aiSearch
    const xbrowserConfig = config.searchPipeline.sources.xbrowser
    return aiConfig.enabled && aiConfig.engines.length > 0 && !!xbrowserConfig.cdpEndpoint
  }

  async search(query: string): Promise<SearchResult[]> {
    const config = loadConfig()
    const aiConfig = config.searchPipeline.sources.aiSearch
    const xbrowserConfig = config.searchPipeline.sources.xbrowser

    const cli = new XBrowserCLI({
      enabled: true,
      engine: "google",
      cdpEndpoint: xbrowserConfig.cdpEndpoint,
      headless: xbrowserConfig.headless,
      timeout: aiConfig.timeout,
    })

    const engines: XBrowserAIEngine[] = (aiConfig.engines as XBrowserAIEngine[]).length > 0
      ? (aiConfig.engines as XBrowserAIEngine[])
      : ["deepseek", "doubao"]

    for (const engine of engines) {
      try {
        const result = await cli.aiSearch(query, engine, {
          limit: config.searchPipeline.maxResults,
          timeout: aiConfig.timeout,
        })

        if (result && result.results && result.results.length > 0) {
          return result.results.map((item) => ({
            title: item.title,
            url: item.url,
            snippet: item.aiSummary || item.snippet,
            source: "ai-search" as const,
            sourceType: "unknown" as const,
            qualityScore: 8,
          }))
        }
      } catch (e) {
        console.debug(`[ai-search] engine=${engine} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return []
  }
}
