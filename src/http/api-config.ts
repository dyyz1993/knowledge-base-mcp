import { IncomingMessage, ServerResponse } from "node:http"
import { loadConfig, saveConfig } from "../config.js"
import type { AppConfig } from "../config.js"
import { getStorageStats } from "../search/vector-store.js"
import { searchStats, llmStats, embeddingStats, mcpStats } from "../statistics/index.js"
import { json, parseBody } from "./helpers.js"

export async function handleConfigRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = loadConfig()
    let storage
    try { storage = getStorageStats() } catch { storage = null }
    const { embedding: emb, webSearch: ws, searchPipeline: sp, ...rest } = config
    json(res, {
      ...rest,
      storage,
      embedding: { ...emb, apiKey: emb?.apiKey ? "****" : "" },
      webSearch: { ...ws, apiKey: ws?.apiKey ? "****" : "" },
      searchPipeline: sp ? {
        ...sp,
        sources: {
          ...sp.sources,
          llmDirect: {
            ...sp.sources?.llmDirect,
            apiKey: sp.sources?.llmDirect?.apiKey ? "****" : ""
          }
        }
      } : sp,
    })
    return true
  }
  if (url.pathname === "/api/config" && req.method === "PUT") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const current = loadConfig()
    const update = body

    if (update.embedding?.apiKey === "****") {
      update.embedding.apiKey = current.embedding.apiKey
    }
    if (update.webSearch?.apiKey === "****") {
      update.webSearch.apiKey = current.webSearch?.apiKey
    }
    if (update.searchPipeline?.sources?.llmDirect?.apiKey === "****") {
      update.searchPipeline.sources.llmDirect.apiKey = current.searchPipeline?.sources?.llmDirect?.apiKey
    }

    const merged: AppConfig = {
      embedding: { ...current.embedding, ...update.embedding },
      search: {
        ...current.search,
        ...update.search,
        weights: { ...current.search.weights, ...update.search?.weights },
      },
      skills: { ...current.skills, ...update.skills },
      browser: { ...current.browser, ...update.browser },
      webSearch: { ...current.webSearch, ...update.webSearch },
      searchPipeline: {
        ...current.searchPipeline,
        ...update.searchPipeline,
        sources: {
          ...current.searchPipeline?.sources,
          ...update.searchPipeline?.sources,
          webSearchPrime: { ...current.searchPipeline?.sources?.webSearchPrime, ...update.searchPipeline?.sources?.webSearchPrime },
          xbrowser: { ...current.searchPipeline?.sources?.xbrowser, ...update.searchPipeline?.sources?.xbrowser },
          llmDirect: { ...current.searchPipeline?.sources?.llmDirect, ...update.searchPipeline?.sources?.llmDirect },
          plugin: { ...current.searchPipeline?.sources?.plugin, ...update.searchPipeline?.sources?.plugin },
        },
      },
      storage: { ...current.storage, ...update.storage },
      timeouts: { ...current.timeouts, ...update.timeouts },
      askPipeline: { ...current.askPipeline, ...update.askPipeline },
      chat: { webSearch: { ...current.chat?.webSearch, ...update.chat?.webSearch } },
    }

    saveConfig(merged)
    json(res, { success: true })
    return true
  }
  if (url.pathname === "/api/stats" && req.method === "GET") {
    const search = searchStats.getStats()
    const llm = llmStats.getStats()
    const embedding = embeddingStats.getStats()
    const mcp = mcpStats.getStats()
    json(res, {
      summary: {
        totalSearchQueries: search.totalQueries,
        totalSearchResults: search.totalResults,
        activeSources: Object.keys(search.sources).length,
        totalLLMCalls: Object.values(llm.models).reduce((sum, m) => sum + m.count, 0),
      },
      searchSources: Object.values(search.sources).map(s => ({
        name: s.name,
        calls: s.count,
        totalTime: s.totalTime,
        avgTime: s.avgTime,
        avgResults: s.count > 0 ? (s.totalResults || 0) / s.count : 0,
        errors: s.errors,
        lastCalled: s.lastCalledAt,
      })),
      llmUsage: Object.values(llm.models).map(m => ({
        name: m.model,
        calls: m.count,
        totalTokens: m.totalTokens,
        avgTokens: m.count > 0 ? m.totalTokens / m.count : 0,
        totalCost: m.totalCost,
        avgTime: m.avgTime,
        lastCalled: m.lastCalledAt,
      })),
      embedding: {
        calls: embedding.count,
        totalTokens: embedding.totalTokens,
        avgTime: embedding.avgTime,
        lastCalled: embedding.lastCalledAt,
      },
      mcpTools: Object.values(mcp.tools).map(t => ({
        name: t.name,
        calls: t.count,
        totalTime: t.totalTime,
        avgTime: t.avgTime,
        errors: t.errors,
        lastCalled: t.lastCalledAt,
      })),
    })
    return true
  }
  if (url.pathname === "/api/stats/reset" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const type = body.type || "all"
    if (type === "search" || type === "all") searchStats.reset()
    if (type === "llm" || type === "all") llmStats.reset()
    if (type === "embedding" || type === "all") embeddingStats.reset()
    if (type === "mcp" || type === "all") mcpStats.reset()
    json(res, { success: true })
    return true
  }
  if (url.pathname === "/api/stats/usage" && req.method === "GET") {
    const config = loadConfig()
    const results: Record<string, { service: string; status: string; used?: number; limit?: number; remaining?: number; balance?: string; plan?: string; rateLimit?: number; note?: string; raw?: unknown }> = {}

    const fetchWithProxy = async (url: string, headers: Record<string, string>) => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 10000)
        const resp = await fetch(url, { headers, signal: controller.signal })
        clearTimeout(timer)
        return await resp.text()
      } catch {
        return ""
      }
    }

    if (config.webSearch.tavilyApiKey) {
      try {
        const raw = await fetchWithProxy("https://api.tavily.com/usage", { "Authorization": `Bearer ${config.webSearch.tavilyApiKey}` })
        const parsed = JSON.parse(raw)
        const keyUsage = parsed.key || parsed
        const accountUsage = parsed.account || {}
        const limit = keyUsage.limit ?? accountUsage.plan_limit
        const used = keyUsage.usage ?? accountUsage.plan_usage ?? 0
        results.tavily = {
          service: "Tavily",
          status: "ok",
          used,
          limit,
          remaining: limit != null ? limit - used : undefined,
          plan: accountUsage.current_plan,
          raw: parsed,
        }
      } catch {
        results.tavily = { service: "Tavily", status: "error" }
      }
    }

    if (config.webSearch.serperApiKey) {
      try {
        const raw = await fetchWithProxy("https://google.serper.dev/account", { "X-API-KEY": config.webSearch.serperApiKey })
        const parsed = JSON.parse(raw)
        results.serper = {
          service: "Serper.dev",
          status: "ok",
          remaining: parsed.balance,
          rateLimit: parsed.rateLimit,
          raw: parsed,
        }
      } catch {
        results.serper = { service: "Serper.dev", status: "error" }
      }
    }

    if (config.embedding.apiKey) {
      try {
        const raw = await fetchWithProxy("https://api.siliconflow.cn/v1/user/info", { "Authorization": `Bearer ${config.embedding.apiKey}` })
        const parsed = JSON.parse(raw)
        results.siliconflow = {
          service: "SiliconFlow (Embedding)",
          status: "ok",
          balance: parsed.data?.totalBalance ?? parsed.totalBalance ?? parsed.data?.balance,
          raw: parsed,
        }
      } catch {
        results.siliconflow = { service: "SiliconFlow (Embedding)", status: "error" }
      }
    }

    results.zhipu = { service: "Zhipu/BigModel (Web Search)", status: "unsupported", note: "No public billing API" }

    json(res, { updatedAt: Date.now(), services: results })
    return true
  }
  return false
}
