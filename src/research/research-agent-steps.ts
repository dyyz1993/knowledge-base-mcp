import type {
  ResearchMode,
  StepDecision,
  ModelTier,
  DeepReadItem,
  SitemapCheck,
  GitHubCheck,
} from "./types"
import type { SearchResult, SourceName, SourceType } from "../search/types"
import { callLlm } from "../search/llm-caller"
import { tierToLlmConfig } from "./model-tier"
import { analyzeQuery } from "./steps/analyze-query"
import { filterResults } from "./steps/filter-results"
import { evaluateResults } from "./steps/evaluate"
import { deepReadUrls } from "./steps/deep-read"
import { evaluateDepth } from "./steps/evaluate-depth"
import { checkSitemap } from "./steps/check-sitemap"
import { checkGithub, fetchGitHubFile } from "./steps/check-github"
import { loadConfig } from "../config"

export interface StepContext {
  query: string
  mode: ResearchMode
  modelTier: ModelTier
  collectedSearchResults: SearchResult[]
  filteredResults: SearchResult[]
  selectedForRead: SearchResult[]
  deepReadResults: DeepReadItem[]
  outline: string
  qualityScore: number
  coverageScore: number
  researchType: string
  missingTopics: string[]
  loopCount: number
  sitemapHints: string[]
  githubHints: string[]
  sitemapResult: SitemapCheck | null
  githubResult: GitHubCheck | null
  progressLog: Array<{ step: string; status: string; output?: unknown }>
  phaseLog: string[]
}

export async function stepAnalyzeQuery(
  ctx: StepContext,
  warning: string,
): Promise<null> {
  const result = await analyzeQuery(
    ctx.query,
    tierToLlmConfig(ctx.modelTier.small),
    warning,
  )
  ctx.researchType = result.researchType || "concept"
  ctx.phaseLog.push(
    `analyzed query: keywords=[${result.coreKeywords.join(", ")}], subQueries=[${result.subQueries.join(", ")}], type=${result.researchType}`,
  )
  return null
}

export async function stepSearch(ctx: StepContext): Promise<null> {
  const config = loadConfig()
  if (!config.searchPipeline?.enabled) {
    ctx.phaseLog.push("search: pipeline not enabled")
    return null
  }

  const sources: import("../search/types").SearchSource[] = []

  if (config.searchPipeline.sources.webSearchPrime.enabled && config.webSearch.apiKey) {
    const { WebSearchPrimeSource } = await import("../search/source-web-search-prime.js")
    sources.push(new WebSearchPrimeSource())
  }

  if (config.searchPipeline.sources.xbrowser.enabled) {
    const { createXBrowserSources } = await import("../search/source-xbrowser.js")
    const engines = config.searchPipeline.sources.xbrowser.engines?.length
      ? config.searchPipeline.sources.xbrowser.engines
      : [config.searchPipeline.sources.xbrowser.engine]
    const xbrowserSources = createXBrowserSources({
      enabled: true,
      engine: config.searchPipeline.sources.xbrowser.engine,
      cdpEndpoint: config.searchPipeline.sources.xbrowser.cdpEndpoint,
      headless: config.searchPipeline.sources.xbrowser.headless,
      timeout: config.searchPipeline.sources.xbrowser.timeout,
    }, engines)
    sources.push(...xbrowserSources)
  }

  if (config.searchPipeline.sources.tavily?.enabled && config.webSearch.tavilyApiKey) {
    const { TavilySource } = await import("../search/source-tavily.js")
    sources.push(new TavilySource())
  }

  if (config.searchPipeline.sources.serper?.enabled && config.webSearch.serperApiKey) {
    const { SerperSource } = await import("../search/source-serper.js")
    sources.push(new SerperSource())
  }

  if (config.searchPipeline.sources.aiSearch?.enabled) {
    const { AiSearchSource } = await import("../search/source-ai-search.js")
    sources.push(new AiSearchSource())
  }

  if (sources.length === 0) {
    ctx.phaseLog.push("search: no sources available")
    return null
  }

  const { SearchPipeline } = await import("../search/search-pipeline.js")
  const pipeline = new SearchPipeline(sources, { fastTimeout: 10_000, slowTimeout: 60_000 })

  const analyzeOutput = ctx.progressLog.find(
    (p) => p.step === "analyze_query" && p.status === "done",
  )?.output as { subQueries?: string[] } | undefined

  let queries: string[]
  if (ctx.missingTopics.length > 0 && ctx.loopCount > 0) {
    queries = ctx.missingTopics.slice(0, 5).map(t => `${ctx.query} ${t}`)
    ctx.phaseLog.push(`gap-driven search: targeting [${ctx.missingTopics.join(", ")}]`)
  } else {
    queries = analyzeOutput?.subQueries?.length
      ? analyzeOutput.subQueries.slice(0, 5)
      : [ctx.query]
  }

  queries = queries.map(q => {
    const tokens = q.split(/\s+/).filter(w => w.length > 1)
    if (tokens.length >= 2 && !q.includes('"') && tokens.length <= 5) {
      return `"${q}" ${q}`
    }
    return q
  })

  const allResults: SearchResult[] = []
  const concurrency = Math.min(queries.length, 5)
  for (let qi = 0; qi < queries.length; qi += concurrency) {
    const batch = queries.slice(qi, qi + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (q) => {
        try {
          const result = await pipeline.search(q, 15)
          return result.results
        } catch (e) {
          ctx.phaseLog.push(`search failed for query: ${q}: ${e instanceof Error ? e.message : String(e)}`)
          return [] as SearchResult[]
        }
      }),
    )
    for (const results of batchResults) {
      allResults.push(...results)
    }
  }

  const { normalizeUrl } = await import("../search/utils.js")
  const seen = new Set<string>()
  ctx.collectedSearchResults = allResults.filter((r) => {
    const key = normalizeUrl(r.url)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  ctx.phaseLog.push(`search: ${ctx.collectedSearchResults.length} results from ${queries.length} queries`)
  return null
}

export async function stepFilterResults(
  ctx: StepContext,
  warning: string,
): Promise<null> {
  if (ctx.collectedSearchResults.length === 0) return null

  const filtered = await filterResults(
    ctx.query,
    ctx.collectedSearchResults,
    tierToLlmConfig(ctx.modelTier.small),
    warning,
  )
  ctx.filteredResults = filtered
  ctx.phaseLog.push(`filtered: ${ctx.collectedSearchResults.length} → ${filtered.length} results`)
  return null
}

export async function stepEvaluate(
  ctx: StepContext,
  warning: string,
): Promise<null> {
  const results = ctx.filteredResults.length > 0
    ? ctx.filteredResults
    : ctx.collectedSearchResults

  if (results.length === 0) return null

  const evalResult = await evaluateResults(
    ctx.query,
    results,
    tierToLlmConfig(ctx.modelTier.large),
    warning,
    ctx.researchType,
  )

  const validIndices = evalResult.selectedIndices.filter(
    (idx: number) => idx >= 0 && idx < results.length,
  )
  ctx.selectedForRead = validIndices.map((idx: number) => results[idx])
  ctx.outline = evalResult.outline
  ctx.sitemapHints = evalResult.sitemapHints || []
  ctx.githubHints = evalResult.githubHints || []
  ctx.phaseLog.push(
    `evaluated: selected ${ctx.selectedForRead.length} URLs for deep reading`,
  )
  return null
}

export async function stepDeepRead(ctx: StepContext): Promise<null> {
  if (ctx.selectedForRead.length === 0) return null

  const urlsToRead = ctx.mode === "quick"
    ? ctx.selectedForRead.slice(0, 3)
    : ctx.selectedForRead

  const config = loadConfig()
  const deepResults = await deepReadUrls(urlsToRead, {
    xbrowserEnabled: config.searchPipeline?.sources.xbrowser.enabled ?? false,
    xbrowserCdp: config.searchPipeline?.sources.xbrowser.cdpEndpoint,
    xbrowserHeadless: config.searchPipeline?.sources.xbrowser.headless,
  })

  const successful = deepResults.filter((r) => r.success)
  ctx.deepReadResults = deepResults
  ctx.phaseLog.push(`deep-read: ${successful.length}/${deepResults.length} URLs read successfully`)
  return null
}

export async function stepEvaluateDepth(
  ctx: StepContext,
  warning: string,
): Promise<StepDecision> {
  const result = await evaluateDepth(
    ctx.query,
    ctx.deepReadResults,
    ctx.outline,
    ctx.mode,
    tierToLlmConfig(ctx.modelTier.large),
    warning,
  )

  ctx.qualityScore = result.qualityScore
  ctx.coverageScore = result.coverageScore
  if (result.updatedOutline) {
    ctx.outline = result.updatedOutline
  }
  if (result.missingTopics?.length) {
    ctx.missingTopics = result.missingTopics
  }

  const gapInfo = result.missingTopics?.length
    ? ` (missing: ${result.missingTopics.join(", ")})`
    : ""
  ctx.phaseLog.push(
    `depth-eval: quality=${result.qualityScore}/10, coverage=${result.coverageScore}/10, decision=${result.decision}${gapInfo}`,
  )

  return result.decision as StepDecision
}

export async function stepCheckSitemap(ctx: StepContext): Promise<StepDecision | null> {
  const hints = ctx.sitemapHints.length > 0
    ? ctx.sitemapHints
    : extractDocSiteUrls(ctx.collectedSearchResults)

  if (hints.length === 0) {
    ctx.phaseLog.push("sitemap: no doc site candidates found")
    ctx.sitemapResult = { isDocSite: false, sitemapUrl: null, relevantPaths: [], priority: [] }
    return null
  }

  ctx.sitemapResult = await checkSitemap(hints, ctx.collectedSearchResults, ctx.query)

  if (!ctx.sitemapResult.isDocSite || ctx.sitemapResult.relevantPaths.length === 0) {
    ctx.phaseLog.push("sitemap: no relevant paths found")
    return null
  }

  const sitemapBase = ctx.sitemapResult.sitemapUrl?.replace(/\/sitemap.*$/, "") || hints[0]
  let base = sitemapBase
  const evaluateDomains = ctx.selectedForRead
    .map(r => { try { return `${new URL(r.url).protocol}//${new URL(r.url).host}` } catch { return "" } })
    .filter(Boolean)
  const uniqueEvaluateDomains = [...new Set(evaluateDomains)]
  if (uniqueEvaluateDomains.length > 0) {
    const domainCounts = new Map<string, number>()
    for (const d of uniqueEvaluateDomains) domainCounts.set(d, (domainCounts.get(d) || 0) + 1)
    const topDomain = [...domainCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
    if (topDomain !== sitemapBase) {
      ctx.phaseLog.push(`sitemap: using evaluate-selected domain ${topDomain} (was ${sitemapBase})`)
      base = topDomain
    }
  } else {
    const allDomains = ctx.collectedSearchResults
      .filter(r => /\/docs|\/guide|\/getting-started|\/api|\/tutorial/.test(r.url))
      .map(r => { try { return `${new URL(r.url).protocol}//${new URL(r.url).host}` } catch { return "" } })
      .filter(Boolean)
    const uniqueDomains = [...new Set(allDomains)].slice(0, 8)
    if (uniqueDomains.length > 1) {
      try {
        const domainList = uniqueDomains.map((d, i) => `[${i}] ${d}`).join("\n")
        const prompt = `Research query: "${ctx.query}"

Which domain is the OFFICIAL documentation site for the main technology?
Return ONLY the domain URL, nothing else. If none, return "none".

Domains:
${domainList}`
        const raw = await callLlm(
          tierToLlmConfig(ctx.modelTier.small),
          [{ role: "system", content: "Return only a single URL or 'none'. No explanation." }, { role: "user", content: prompt }],
          0.1, 100, 10000,
        )
        const cleaned = raw.trim().replace(/^["']|["']$/g, "")
        if (cleaned !== "none" && uniqueDomains.some(d => {
          try { return cleaned.includes(new URL(d).hostname) } catch { return false }
        })) {
          const picked = cleaned.startsWith("http") ? cleaned : uniqueDomains.find(d => { try { return d.includes(cleaned) } catch { return false } }) || sitemapBase
          if (picked !== sitemapBase) {
            ctx.phaseLog.push(`sitemap: LLM picked ${picked} over ${sitemapBase}`)
            base = picked
          }
        }
      } catch {
        // LLM failed, keep sitemapBase
      }
    }
  }
  const paths = ctx.sitemapResult.relevantPaths.slice(0, 15)
  const urls: SearchResult[] = paths.map(p => ({ title: p.split("/").pop() || p, url: `${base}${p}`, snippet: "", source: "sitemap" as SourceName, sourceType: "official" as SourceType, qualityScore: 90 }))

  ctx.phaseLog.push(`sitemap: found ${ctx.sitemapResult.relevantPaths.length} paths, deep-reading ${urls.length}`)

  const config = loadConfig()
  const sitemapDR = await deepReadUrls(urls, {
    xbrowserEnabled: config.searchPipeline?.sources.xbrowser.enabled ?? false,
    xbrowserCdp: config.searchPipeline?.sources.xbrowser.cdpEndpoint,
    xbrowserHeadless: config.searchPipeline?.sources.xbrowser.headless,
    skipXbrowser: true,
  })

  const successful = sitemapDR.filter(r => r.success)
  const existingUrls = new Set(ctx.deepReadResults.map(r => r.url))
  const newResults = successful.filter(r => !existingUrls.has(r.url))
  ctx.deepReadResults.push(...newResults)
  ctx.phaseLog.push(`sitemap deep-read: ${newResults.length}/${sitemapDR.length} pages read (${successful.length - newResults.length} deduped)`)

  return null
}

export async function stepCheckGithub(ctx: StepContext): Promise<StepDecision | null> {
  const hints = ctx.githubHints.length > 0
    ? ctx.githubHints
    : extractGithubUrls(ctx.collectedSearchResults)

  if (hints.length === 0) {
    ctx.phaseLog.push("github: no repo candidates found")
    ctx.githubResult = { repoUrl: null, needsClone: false, targetPaths: [], searchKeywords: [] }
    return null
  }

  ctx.githubResult = await checkGithub(hints, ctx.collectedSearchResults, ctx.query)

  if (!ctx.githubResult.repoUrl) {
    ctx.phaseLog.push("github: no valid repo identified")
    return null
  }

  const paths = ctx.githubResult.targetPaths.slice(0, 10)
  ctx.phaseLog.push(`github: found ${ctx.githubResult.repoUrl}, reading ${paths.length} files: ${paths.join(", ")}`)

  const results: DeepReadItem[] = []
  const contents = await Promise.allSettled(
    paths.map(p => fetchGitHubFile(ctx.githubResult!.repoUrl!, p).then(content => {
      if (content && content.length > 50) {
        const rawUrl = ctx.githubResult!.repoUrl!
          .replace("github.com", "raw.githubusercontent.com")
        return {
          title: `${ctx.githubResult!.repoUrl}/${p}`,
          url: `${rawUrl}/HEAD/${p}`,
          content: content.slice(0, 15000),
          success: true,
          source: "github" as const,
        }
      }
      return null
    }).catch(() => null))
  )
  for (const r of contents) {
    if (r.status === "fulfilled" && r.value) {
      results.push(r.value)
    } else if (r.status === "rejected") {
      ctx.phaseLog.push(`github: failed to fetch: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    }
  }

  const successful = results.filter(r => r.success)
  const existingUrls = new Set(ctx.deepReadResults.map(r => r.url))
  const newResults = successful.filter(r => !existingUrls.has(r.url))
  ctx.deepReadResults.push(...newResults)
  ctx.phaseLog.push(`github: ${newResults.length}/${paths.length} files read (${successful.length - newResults.length} deduped)`)

  return null
}

export function extractDocSiteUrls(searchResults: SearchResult[]): string[] {
  const urls: string[] = []
  for (const r of searchResults) {
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
    } catch { continue }
  }
  return urls.slice(0, 5)
}

export function extractGithubUrls(searchResults: SearchResult[]): string[] {
  const urls: string[] = []
  const pattern = /github\.com\/([^/]+\/[^/]+)/
  for (const r of searchResults) {
    const m = r.url.match(pattern)
    if (m) {
      const repo = `https://github.com/${m[1]}`
      if (!urls.includes(repo)) urls.push(repo)
    }
  }
  return urls.slice(0, 3)
}
