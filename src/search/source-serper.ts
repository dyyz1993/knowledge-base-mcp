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

export class SerperSource implements SearchSource {
  name = "serper" as const

  available(): boolean {
    const config = loadConfig()
    return !!config.webSearch.serperApiKey
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.available()) return []
    const config = loadConfig()
    const apiKey = config.webSearch.serperApiKey

    try {
      const body = JSON.stringify({ q: query, num: 10, gl: "us" })
      const raw = fetchWithProxy("https://google.serper.dev/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
        body,
      })
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed.organic)) return []

      return parsed.organic.map((r: Record<string, unknown>) => ({
        title: String(r.title || ""),
        url: String(r.link || ""),
        snippet: String(r.snippet || "").slice(0, 300),
        source: "serper" as const,
        sourceType: "unknown" as const,
        qualityScore: 5,
      }))
    } catch {
      return []
    }
  }
}
