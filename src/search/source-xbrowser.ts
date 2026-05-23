import { XBrowserCLI } from "./xbrowser-cli"
import type { SearchSource, SearchResult, SourceName } from "./types"
import type { XBrowserConfig, XBrowserEngine } from "./xbrowser-cli"
import { normalizeUrl } from "./utils"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("search:source-xbrowser")

function filterIrrelevant(query: string, results: Array<{ title: string; url: string; snippet: string }>): typeof results {
  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2)
  if (queryWords.length === 0 || results.length <= 3) return results

  return results.filter(r => {
    const text = `${r.title} ${r.snippet}`.toLowerCase()
    return queryWords.some(w => text.includes(w))
  })
}
const ENGINE_NAMES: Record<XBrowserEngine, SourceName> = {
  google: "xbrowser-google",
  bing: "xbrowser-bing",
  baidu: "xbrowser-baidu",
  duckduckgo: "xbrowser-duckduckgo",
}

export class XBrowserEngineSource implements SearchSource {
  name: SourceName
  private cli: XBrowserCLI
  private engineName: string

  constructor(config: XBrowserConfig, engine: XBrowserEngine) {
    this.name = ENGINE_NAMES[engine]
    this.engineName = engine
    this.cli = new XBrowserCLI({ ...config, engine })
  }

  available(): boolean {
    return true
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const t0 = Date.now()
      const results = await this.cli.search(query, 10)
      const ms = Date.now() - t0
      const filtered = filterIrrelevant(query, results)
      logger.debug(`[xbrowser-${this.engineName}] Query: "${query}" -> ${filtered.length}/${results.length} results in ${ms}ms`)
      return filtered.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet.slice(0, 300),
        source: this.name,
        sourceType: "unknown" as const,
        qualityScore: 0,
      }))
    } catch (err) {
      logger.debug(`[xbrowser-${this.engineName}] ERROR for "${query}": ${err instanceof Error ? err.message : err}`)
      return []
    }
  }
}

interface MergedEntry {
  result: SearchResult
  hitCount: number
  bestRank: number
}

export class XBrowserMultiEngineSource implements SearchSource {
  name = "xbrowser" as const
  private engines: XBrowserEngine[]
  private config: XBrowserConfig

  constructor(config: XBrowserConfig, engines: XBrowserEngine[]) {
    this.config = config
    this.engines = engines
  }

  available(): boolean {
    return true
  }

  async search(query: string): Promise<SearchResult[]> {
    const t0 = Date.now()
    const perEngine = await Promise.allSettled(
      this.engines.map(async (engine) => {
        const cli = new XBrowserCLI({ ...this.config, engine })
        const raw = await cli.search(query, 10)
        return raw.map((r, idx) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet.slice(0, 300),
          engine,
          rank: idx,
        }))
      }),
    )

    const allItems: { url: string; title: string; snippet: string; engine: XBrowserEngine; rank: number }[] = []
    for (let i = 0; i < perEngine.length; i++) {
      const settled = perEngine[i]
      if (settled.status === "fulfilled") {
        allItems.push(...settled.value)
      } else {
        logger.debug(`[xbrowser-multi] engine=${this.engines[i]} FAILED: ${settled.reason}`)
      }
    }

    const urlMap = new Map<string, MergedEntry>()
    for (const item of allItems) {
      const normalizedUrl = normalizeUrl(item.url)
      const existing = urlMap.get(normalizedUrl)
      if (existing) {
        existing.hitCount++
        if (item.rank < existing.bestRank) {
          existing.bestRank = item.rank
        }
      } else {
        urlMap.set(normalizedUrl, {
          result: {
            title: item.title,
            url: item.url,
            snippet: item.snippet,
            source: "xbrowser" as const,
            sourceType: "unknown" as const,
            qualityScore: 0,
          },
          hitCount: 1,
          bestRank: item.rank,
        })
      }
    }

    const merged = Array.from(urlMap.values())
    merged.sort((a, b) => {
      if (b.hitCount !== a.hitCount) return b.hitCount - a.hitCount
      return a.bestRank - b.bestRank
    })

    const results = merged.map((entry, idx) => ({
      ...entry.result,
      qualityScore: entry.hitCount > 1 ? Math.min(0.5 + entry.hitCount * 0.15, 1) : 0,
    }))

    const ms = Date.now() - t0
    const succeeded = perEngine.filter(s => s.status === "fulfilled").length
    logger.debug(
      `[search] [xbrowser-multi] Query: "${query}" -> ${results.length} results (from ${succeeded}/${this.engines.length} engines) in ${ms}ms`,
    )
    return results
  }
}

export function createXBrowserSources(
  config: XBrowserConfig,
  engines: XBrowserEngine[],
): SearchSource[] {
  if (!config.enabled) return []

  const engineList = engines.length > 0 ? engines : (["google"] as XBrowserEngine[])
  return [new XBrowserMultiEngineSource(config, engineList)]
}

export class XBrowserSource implements SearchSource {
  name = "xbrowser" as const
  private cli: XBrowserCLI

  constructor(config: XBrowserConfig) {
    this.cli = new XBrowserCLI(config)
  }

  available(): boolean {
    return true
  }

  async search(query: string): Promise<SearchResult[]> {
    try {
      const results = await this.cli.search(query, 5)
      return results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet.slice(0, 300),
        source: "xbrowser" as const,
        sourceType: "unknown" as const,
        qualityScore: 0,
      }))
    } catch {
      return []
    }
  }
}
