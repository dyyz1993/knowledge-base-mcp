import { XBrowserCLI } from "./xbrowser-cli"
import type { SearchSource, SearchResult, SourceName } from "./types"
import type { XBrowserConfig, XBrowserEngine } from "./xbrowser-cli"

const ENGINE_NAMES: Record<XBrowserEngine, SourceName> = {
  bing: "xbrowser-bing",
  google: "xbrowser-google",
  baidu: "xbrowser-baidu",
  duckduckgo: "xbrowser-duckduckgo",
}

class XBrowserEngineSource implements SearchSource {
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
      const results = await this.cli.search(query, 5)
      return results.map(r => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet.slice(0, 300),
        source: this.name,
        sourceType: "unknown" as const,
        qualityScore: 0,
      }))
    } catch {
      return []
    }
  }
}

export function createXBrowserSources(
  config: XBrowserConfig,
  engines: XBrowserEngine[],
): SearchSource[] {
  if (!config.enabled) return []

  const engineList = engines.length > 0 ? engines : ["bing" as XBrowserEngine]
  return engineList.map(engine => new XBrowserEngineSource(config, engine))
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
