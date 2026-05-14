import { XBrowserCLI } from "./xbrowser-cli"
import type { SearchSource, SearchResult } from "./types"
import type { XBrowserConfig } from "./xbrowser-cli"

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
