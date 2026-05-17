import { execSync } from "node:child_process"
import { loadConfig } from "../config"
import type { SearchSource, SearchResult } from "./types"

function fetchWithProxy(url: string, options: { method?: string; headers?: Record<string, string>; body?: string }): string {
  const method = options.method || "GET"
  const proxy = process.env.https_proxy || process.env.http_proxy || process.env.all_proxy || ""
  const headerArgs = Object.entries(options.headers || {})
    .map(([k, v]) => `-H '${k}: ${v}'`)
    .join(" ")
  const bodyArg = options.body ? `-d '${options.body.replace(/'/g, "'\\''")}'` : ""
  const proxyArg = proxy ? `--proxy '${proxy}'` : ""
  const cmd = `curl -s -X ${method} '${url}' ${headerArgs} ${bodyArg} ${proxyArg} --max-time 15`
  return execSync(cmd, { encoding: "utf-8", timeout: 20000 })
}

export class TavilySource implements SearchSource {
  name = "tavily" as const

  available(): boolean {
    const config = loadConfig()
    return !!config.webSearch.tavilyApiKey
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.available()) return []
    const config = loadConfig()
    const apiKey = config.webSearch.tavilyApiKey

    try {
      const body = JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 10,
        include_answer: false,
      })
      const raw = fetchWithProxy("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed.results)) return []

      return parsed.results.map((r: Record<string, unknown>) => ({
        title: String(r.title || ""),
        url: String(r.url || ""),
        snippet: String(r.content || "").slice(0, 300),
        source: "tavily" as const,
        sourceType: "unknown" as const,
        qualityScore: 5,
      }))
    } catch {
      return []
    }
  }
}
