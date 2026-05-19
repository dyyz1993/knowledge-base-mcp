import { getMcpWebSearch } from "./mcp-web-search"
import type { SearchSource, SearchResult, SourceType } from "./types"

function inferSourceType(url: string): SourceType {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (host.includes("github.com")) return "repository"
    if (host.startsWith("docs.") || u.pathname.includes("/docs")) return "documentation"
    if (host.endsWith(".dev") || host.endsWith(".org")) return "official"
    if (host.includes("medium.com") || host.includes("blog.") || host.includes("dev.to")) return "blog"
    const platforms = ["zhihu.com", "juejin.cn", "stackoverflow.com", "csdn.net", "segmentfault.com"]
    if (platforms.some(p => host.endsWith(p))) return "platform"
    return "blog"
  } catch {
    return "unknown"
  }
}

export class WebSearchPrimeSource implements SearchSource {
  name = "web-search-prime" as const

  available(): boolean {
    return getMcpWebSearch() !== null
  }

  async search(query: string): Promise<SearchResult[]> {
    const client = getMcpWebSearch()
    if (!client) return []
    const results = await client.search(query, 10)
    return results.map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.content.slice(0, 300),
      source: "web-search-prime" as const,
      sourceType: inferSourceType(r.link),
      qualityScore: 50,
    }))
  }
}
