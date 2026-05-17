/**
 * @deprecated 此文件已废弃。搜索功能已迁移到 SearchPipeline + 独立 SearchSource。
 * - Tavily → source-tavily.ts
 * - Serper → source-serper.ts  
 * - MCP → source-web-search-prime.ts
 * - AI Search → source-ai-search.ts
 * 
 * 保留此文件仅供参考，不要再在新代码中 import。
 */

import { execSync } from "node:child_process"
import { getMcpWebSearch } from "./mcp-web-search"
import { loadConfig } from "../config"

export interface MultiSourceWebResult {
  title: string
  link: string
  content: string
  source: "mcp" | "tavily" | "serper"
}

function fetchWithProxy(url: string, options: { method?: string; headers?: Record<string, string>; body?: string }): string {
  const method = options.method || "GET"
  // 优先读环境变量，否则用本地默认代理
  const proxy = process.env.https_proxy || process.env.http_proxy || process.env.all_proxy || ""
  const headerArgs = Object.entries(options.headers || {})
    .map(([k, v]) => `-H '${k}: ${v}'`)
    .join(" ")
  const bodyArg = options.body ? `-d '${options.body.replace(/'/g, "'\\''")}'` : ""
  const proxyArg = proxy ? `--proxy '${proxy}'` : ""
  const cmd = `curl -s -X ${method} '${url}' ${headerArgs} ${bodyArg} ${proxyArg} --max-time 15`
  return execSync(cmd, { encoding: "utf-8", timeout: 20000 })
}

async function searchViaMcp(query: string, maxResults: number): Promise<MultiSourceWebResult[]> {
  try {
    const mcp = getMcpWebSearch()
    if (!mcp) return []
    const results = await mcp.search(query, maxResults)
    return results.map(r => ({ ...r, source: "mcp" as const }))
  } catch {
    return []
  }
}

function searchViaTavily(query: string, maxResults: number, apiKey: string): MultiSourceWebResult[] {
  try {
    const body = JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: maxResults,
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
      link: String(r.url || ""),
      content: String(r.content || ""),
      source: "tavily" as const,
    }))
  } catch {
    return []
  }
}

function searchViaSerper(query: string, maxResults: number, apiKey: string): MultiSourceWebResult[] {
  try {
    const body = JSON.stringify({ q: query, num: maxResults, gl: "us" })
    const raw = fetchWithProxy("https://google.serper.dev/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body,
    })
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.organic)) return []
    return parsed.organic.map((r: Record<string, unknown>) => ({
      title: String(r.title || ""),
      link: String(r.link || ""),
      content: String(r.snippet || ""),
      source: "serper" as const,
    }))
  } catch {
    return []
  }
}

export async function webSearch(query: string, maxResults: number = 5): Promise<MultiSourceWebResult[]> {
  const config = loadConfig()
  const allResults: MultiSourceWebResult[] = []

  // Priority 1: MCP web search (async)
  if (config.webSearch.apiKey && config.webSearch.enabled) {
    const mcpResults = await searchViaMcp(query, maxResults)
    allResults.push(...mcpResults)
  }

  // Priority 2: Tavily
  if (config.webSearch.tavilyApiKey) {
    const tavilyResults = searchViaTavily(query, maxResults, config.webSearch.tavilyApiKey)
    allResults.push(...tavilyResults)
  }

  // Priority 3: Serper
  if (config.webSearch.serperApiKey) {
    const serperResults = searchViaSerper(query, maxResults, config.webSearch.serperApiKey)
    allResults.push(...serperResults)
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  const deduped: MultiSourceWebResult[] = []
  for (const r of allResults) {
    const link = r.link || ""
    if (!link || seen.has(link)) continue
    seen.add(link)
    deduped.push({ ...r, link })
  }

  return deduped.slice(0, maxResults)
}
