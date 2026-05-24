import type { SearchResult, SourceName, SourceType } from "../../search/types"
import type { SitemapCheck } from "../types"
import { tierToLlmConfig } from "../model-tier"
import { checkSitemap } from "./check-sitemap"
import { deepReadUrls } from "./deep-read"
import { createLogger } from "../../utils/logger.js"

const logger = createLogger("research:steps:agent-sitemap")

export interface SitemapState {
  query: string
  mode: "quick" | "standard" | "deep"
  sitemapHints: string[]
  collectedSearchResults: SearchResult[]
  selectedForRead: SearchResult[]
  deepReadResults: import("../types").DeepReadItem[]
  phaseLog: string[]
  modelTier: { small: { baseUrl: string; apiKey: string; model: string }; large: { baseUrl: string; apiKey: string; model: string } }
}

export function extractDocSiteUrls(results: SearchResult[]): string[] {
  const urls: string[] = []
  for (const r of results) {
    try {
      const u = new URL(r.url)
      const base = `${u.protocol}//${u.hostname}`
      if (
        u.pathname.includes("/docs") ||
        u.hostname.startsWith("docs.") ||
        r.sourceType === "official"
      ) {
        if (!urls.includes(base)) urls.push(base)
      }
    } catch { logger.warn("URL parse failed in extractDocSiteUrls"); continue }
  }
  return urls.slice(0, 5)
}

export async function executeCheckSitemap(state: SitemapState): Promise<SitemapCheck> {
  const hints = state.sitemapHints.length > 0
    ? state.sitemapHints
    : extractDocSiteUrls(state.collectedSearchResults)

  if (hints.length === 0) {
    state.phaseLog.push("sitemap: no doc site candidates found")
    return { isDocSite: false, sitemapUrl: null, relevantPaths: [], priority: [] }
  }

  const sitemapResult = await checkSitemap(hints, state.collectedSearchResults, state.query)

  if (!sitemapResult.isDocSite || sitemapResult.relevantPaths.length === 0) {
    state.phaseLog.push("sitemap: no relevant paths found")
    return sitemapResult
  }

  const sitemapBase = sitemapResult.sitemapUrl?.replace(/\/sitemap.*$/, "") || hints[0]
  let base = sitemapBase

  const evaluateDomains = state.selectedForRead
    .map(r => { try { return `${new URL(r.url).protocol}//${new URL(r.url).host}` } catch { return "" } })
    .filter(Boolean)
  const uniqueEvaluateDomains = [...new Set(evaluateDomains)]
  if (uniqueEvaluateDomains.length > 0) {
    const domainCounts = new Map<string, number>()
    for (const d of uniqueEvaluateDomains) domainCounts.set(d, (domainCounts.get(d) || 0) + 1)
    const topDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    if (topDomain !== sitemapBase) {
      state.phaseLog.push(`sitemap: using evaluate-selected domain ${topDomain} (was ${sitemapBase})`)
      base = topDomain
    }
  } else {
    const allDomains = state.collectedSearchResults
      .filter(r => /\/docs|\/guide|\/getting-started|\/api|\/tutorial/.test(r.url))
      .map(r => { try { return `${new URL(r.url).protocol}//${new URL(r.url).host}` } catch { return "" } })
      .filter(Boolean)
    const uniqueDomains = [...new Set(allDomains)].slice(0, 8)
    if (uniqueDomains.length > 1) {
      try {
        const { callLlm } = await import("../../search/llm-caller.js")
        const domainList = uniqueDomains.map((d, i) => `[${i}] ${d}`).join("\n")
        const prompt = `Research query: "${state.query}"

Which domain is the OFFICIAL documentation site for the main technology?
Return ONLY the domain URL, nothing else. If none, return "none".

Domains:
${domainList}`
        const raw = await callLlm(
          tierToLlmConfig(state.modelTier.small),
          [{ role: "system", content: "Return only a single URL or 'none'. No explanation." }, { role: "user", content: prompt }],
          0.1, 100, 10000,
        )
        const cleaned = raw.trim().replace(/^["']|["']$/g, "")
        if (cleaned !== "none" && uniqueDomains.some(d => {
          try { return cleaned.includes(new URL(d).hostname) } catch { return false }
        })) {
          const picked = cleaned.startsWith("http") ? cleaned : uniqueDomains.find(d => { try { return d.includes(cleaned) } catch { return false } }) || sitemapBase
          if (picked !== sitemapBase) {
            state.phaseLog.push(`sitemap: LLM picked ${picked} over ${sitemapBase}`)
            base = picked
          }
        }
      } catch (err) {
        logger.warn("LLM domain picking failed in agent-sitemap", { error: String(err) })
      }
    }
  }

  const paths = sitemapResult.relevantPaths.slice(0, 15)
  const urls: SearchResult[] = paths.map(p => ({ title: p.split("/").pop() || p, url: `${base}${p}`, snippet: "", source: "sitemap" as SourceName, sourceType: "official" as SourceType, qualityScore: 90 }))

  state.phaseLog.push(`sitemap: found ${sitemapResult.relevantPaths.length} paths, deep-reading ${urls.length}`)

  const { loadConfig } = await import("../../config.js")
  const config = loadConfig()
  const sitemapDR = await deepReadUrls(urls, {
    xbrowserEnabled: config.searchPipeline?.sources.xbrowser.enabled ?? false,
    xbrowserCdp: config.searchPipeline?.sources.xbrowser.cdpEndpoint,
    xbrowserHeadless: config.searchPipeline?.sources.xbrowser.headless,
    skipXbrowser: true,
  })

  const successful = sitemapDR.filter(r => r.success)
  const existingUrls = new Set(state.deepReadResults.map(r => r.url))
  const newResults = successful.filter(r => !existingUrls.has(r.url))
  state.deepReadResults.push(...newResults)
  state.phaseLog.push(`sitemap deep-read: ${newResults.length}/${sitemapDR.length} pages read (${successful.length - newResults.length} deduped)`)

  return sitemapResult
}
