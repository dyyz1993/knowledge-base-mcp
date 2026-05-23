import { getMcpWebSearch } from "./mcp-web-search"
import type { SearchSource, SearchResult, SourceType } from "./types"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("search:source-web-search-prime")
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
  private consecutiveZeroCount = 0
  private static readonly DISABLE_AFTER_CONSECUTIVE_ZEROS = 3
  private disabled = false

  available(): boolean {
    if (this.disabled) return false
    const client = getMcpWebSearch()
    if (!client) return false
    // If MCP detected quota exceeded, report unavailable so pipeline uses fallback sources
    return client.searchAvailable
  }

  async search(query: string): Promise<SearchResult[]> {
    const client = getMcpWebSearch()
    if (!client || !client.searchAvailable) return []
    const results = await client.search(query, 10)

    if (results.length === 0) {
      this.consecutiveZeroCount++
      if (this.consecutiveZeroCount >= WebSearchPrimeSource.DISABLE_AFTER_CONSECUTIVE_ZEROS) {
        this.disabled = true
        logger.warn(`[web-search-prime] Disabled after ${this.consecutiveZeroCount} consecutive zero-result calls`)
      }
    } else {
      this.consecutiveZeroCount = 0
    }

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
