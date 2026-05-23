import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { loadConfig } from "../config"
import type { SearchSource, SearchResult } from "./types"

const execFileAsync = promisify(execFile)

let consecutiveFailures = 0
let disabledUntil = 0

async function fetchWithProxy(url: string, options: { method?: string; headers?: Record<string, string>; body?: string }): Promise<string> {
  const method = options.method || "GET"
  const proxy = process.env.https_proxy || process.env.http_proxy || process.env.all_proxy || ""
  const args: string[] = ["-s", "-X", method, url]
  for (const [k, v] of Object.entries(options.headers || {})) {
    args.push("-H", `${k}: ${v}`)
  }
  if (options.body) args.push("-d", options.body)
  if (proxy) args.push("--proxy", proxy)
  args.push("--max-time", "15")
  const { stdout } = await execFileAsync("curl", args, { encoding: "utf-8", timeout: 20_000 })
  return stdout
}

export class TavilySource implements SearchSource {
  name = "tavily" as const

  available(): boolean {
    const config = loadConfig()
    return !!config.webSearch.tavilyApiKey
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.available()) return []
    if (Date.now() < disabledUntil) return []
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
      const raw = await fetchWithProxy("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed.results)) return []

      consecutiveFailures = 0
      return parsed.results.map((r: Record<string, unknown>) => ({
        title: String(r.title || ""),
        url: String(r.url || ""),
        snippet: String(r.content || "").slice(0, 300),
        source: "tavily" as const,
        sourceType: "unknown" as const,
        qualityScore: 5,
      }))
    } catch {
      consecutiveFailures++
      if (consecutiveFailures >= 5) {
        disabledUntil = Date.now() + 300_000
      }
      return []
    }
  }
}
