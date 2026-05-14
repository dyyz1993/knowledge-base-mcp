import { getMcpWebSearch } from "./mcp-web-search"
import type { SearchSource, SearchResult } from "./types"

export class WebSearchPrimeSource implements SearchSource {
  name = "web-search-prime" as const

  available(): boolean {
    return getMcpWebSearch() !== null
  }

  async search(query: string): Promise<SearchResult[]> {
    const client = getMcpWebSearch()
    if (!client) return []
    const results = await client.search(query, 5)
    return results.map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.content.slice(0, 300),
      source: "web-search-prime" as const,
      sourceType: "unknown" as const,
      qualityScore: 0,
    }))
  }
}
