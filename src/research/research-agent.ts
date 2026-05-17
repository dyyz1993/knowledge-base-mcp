import type {
  ResearchMode,
  ResearchResult,
  ResearchProgress,
  StepName,
  ModelTier,
  ResearchRequest,
  DeepReadItem,
  StepDecision,
} from "./types"
import { QUICK_FLOW, STANDARD_FLOW, DEEP_FLOW } from "./types"
import { BudgetManager } from "./budget-manager"
import { inferModelTier, tierToLlmConfig } from "./model-tier"
import { callLlm } from "../search/llm-caller"
import { analyzeQuery } from "./steps/analyze-query"
import { filterResults } from "./steps/filter-results"
import { evaluateResults } from "./steps/evaluate"
import { deepReadUrls } from "./steps/deep-read"
import { evaluateDepth } from "./steps/evaluate-depth"
import { synthesize } from "./steps/synthesize"
import { checkSitemap } from "./steps/check-sitemap"
import { checkGithub, fetchGitHubFile } from "./steps/check-github"
import { loadConfig } from "../config"
import type { SearchResult } from "../search/types"
import type { SitemapCheck, GitHubCheck } from "./types"

type ProgressCallback = (progress: ResearchProgress) => void

export class ResearchAgent {
  private budget: BudgetManager
  private modelTier: ModelTier
  private mode: ResearchMode
  private query: string
  private onProgress: ProgressCallback
  private progressLog: ResearchProgress[] = []
  private phaseLog: string[] = []
  private startTime = 0

  private collectedSearchResults: SearchResult[] = []
  private filteredResults: SearchResult[] = []
  private selectedForRead: SearchResult[] = []
  private deepReadResults: DeepReadItem[] = []
  private outline = ""
  private qualityScore = 0
  private coverageScore = 0
  private missingTopics: string[] = []
  private loopCount = 0
  private sitemapHints: string[] = []
  private githubHints: string[] = []
  private sitemapResult: SitemapCheck | null = null
  private githubResult: GitHubCheck | null = null

  constructor(
    request: ResearchRequest,
    onProgress: ProgressCallback,
  ) {
    this.query = request.query
    this.mode = request.mode || "standard"
    this.onProgress = onProgress
    this.budget = new BudgetManager(this.mode)

    const tier = inferModelTier(
      request.model || { provider: "zhipuai", id: "glm-5.1" },
      request.smallModel,
    )
    if (!tier) {
      throw new Error("No model configured. Please configure a model with API key.")
    }
    this.modelTier = tier
  }

  async run(): Promise<ResearchResult> {
    this.startTime = Date.now()
    const flow = this.getFlow()

    let i = 0
    while (i < flow.length) {
      const stepName = flow[i]

      if (this.budget.isCritical() && stepName !== "synthesize") {
        this.emit("synthesize", "running")
        const summary = await this.doSynthesize()
        return this.buildResult(summary, true)
      }

      if (!this.budget.canAfford(stepName)) {
        this.phaseLog.push(`${stepName}: skipped (budget exhausted)`)
        i++
        continue
      }

      const skipDecision = this.shouldSkipStep(stepName)
      if (skipDecision) {
        this.emit(stepName, "skipped")
        this.phaseLog.push(`${stepName}: skipped (${skipDecision})`)
        i++
        continue
      }

      this.budget.spend(stepName)
      this.emit(stepName, "running")

      try {
        const decision = await this.executeStep(stepName)
        this.emit(stepName, "done")

        const shouldFinalize = decision === "done" &&
          !["check_sitemap", "check_github"].some(s => flow.slice(i + 1).includes(s))

        if (shouldFinalize || stepName === "synthesize") {
          const summary = await this.doSynthesize()
          return this.buildResult(summary, false)
        }

        if (decision === "need_more_search") {
          this.loopCount++
          if (this.loopCount > 2) {
            this.phaseLog.push("max loops reached, proceeding to synthesize")
          } else {
            i = this.findStepIndex(flow, "analyze_query")
            if (i >= 0) {
              const gapInfo = this.missingTopics.length
                ? ` (targeting: ${this.missingTopics.slice(0, 3).join(", ")})`
                : ""
              this.phaseLog.push(`looping back: re-searching with gap keywords${gapInfo}`)
              i++
              continue
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.emit(stepName, "failed")
        this.phaseLog.push(`${stepName}: failed (${msg})`)

        if (stepName === "synthesize") {
          return this.buildResult(this.buildFallbackSummary(), true)
        }
      }

      i++
    }

    const summary = await this.doSynthesize()
    return this.buildResult(summary, false)
  }

  private getFlow(): StepName[] {
    switch (this.mode) {
      case "quick": return [...QUICK_FLOW]
      case "standard": return [...STANDARD_FLOW]
      case "deep": return [...DEEP_FLOW]
    }
  }

  private findStepIndex(flow: StepName[], step: StepName): number {
    return flow.indexOf(step)
  }

  private shouldSkipStep(stepName: StepName): string | null {
    if (stepName === "check_sitemap" || stepName === "follow_paths") {
      if (this.mode === "quick") return "not applicable for quick mode"
    }
    if (stepName === "clone_index" || stepName === "code_search") {
      if (this.mode === "quick" || this.mode === "standard") return "only for deep mode"
    }
    return null
  }

  private async executeStep(stepName: StepName): Promise<StepDecision | null> {
    const warning = this.budget.getWarningPrompt()

    switch (stepName) {
      case "analyze_query": return this.stepAnalyzeQuery(warning)
      case "search": return this.stepSearch()
      case "filter_results": return this.stepFilterResults(warning)
      case "evaluate": return this.stepEvaluate(warning)
      case "deep_read": return this.stepDeepRead()
      case "evaluate_depth": return this.stepEvaluateDepth(warning)
      case "check_sitemap": return this.stepCheckSitemap()
      case "check_github": return this.stepCheckGithub()
      case "synthesize": return null
      default: return null
    }
  }

  private async stepAnalyzeQuery(warning: string): Promise<null> {
    const result = await analyzeQuery(
      this.query,
      tierToLlmConfig(this.modelTier.small),
      warning,
    )
    this.phaseLog.push(
      `analyzed query: keywords=[${result.coreKeywords.join(", ")}], subQueries=[${result.subQueries.join(", ")}], type=${result.researchType}`,
    )
    this.emit("analyze_query", "done", result)
    return null
  }

  private async stepSearch(): Promise<null> {
    const config = loadConfig()
    if (!config.searchPipeline?.enabled) {
      this.phaseLog.push("search: pipeline not enabled")
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
      this.phaseLog.push("search: no sources available")
      return null
    }

    const { SearchPipeline } = await import("../search/search-pipeline.js")
    const pipeline = new SearchPipeline(sources, { fastTimeout: 10_000, slowTimeout: 60_000 })

    const analyzeOutput = this.progressLog.find(
      (p) => p.step === "analyze_query" && p.status === "done",
    )?.output as { subQueries?: string[] } | undefined

    let queries: string[]
    if (this.missingTopics.length > 0 && this.loopCount > 0) {
      queries = this.missingTopics.slice(0, 5).map(t => `${this.query} ${t}`)
      this.phaseLog.push(`gap-driven search: targeting [${this.missingTopics.join(", ")}]`)
    } else {
      queries = analyzeOutput?.subQueries?.length
        ? analyzeOutput.subQueries.slice(0, 5)
        : [this.query]
    }

    const allResults: SearchResult[] = []
    for (const q of queries) {
      try {
        const result = await pipeline.search(q, 15)
        allResults.push(...result.results)
      } catch {
        this.phaseLog.push(`search failed for query: ${q}`)
      }
    }

    const seen = new Set<string>()
    this.collectedSearchResults = allResults.filter((r) => {
      if (seen.has(r.url)) return false
      seen.add(r.url)
      return true
    })

    this.phaseLog.push(`search: ${this.collectedSearchResults.length} results from ${queries.length} queries`)
    return null
  }

  private async stepFilterResults(warning: string): Promise<null> {
    if (this.collectedSearchResults.length === 0) return null

    const filtered = await filterResults(
      this.query,
      this.collectedSearchResults,
      tierToLlmConfig(this.modelTier.small),
      warning,
    )
    this.filteredResults = filtered
    this.phaseLog.push(`filtered: ${this.collectedSearchResults.length} → ${filtered.length} results`)
    return null
  }

  private async stepEvaluate(warning: string): Promise<null> {
    const results = this.filteredResults.length > 0
      ? this.filteredResults
      : this.collectedSearchResults

    if (results.length === 0) return null

    const evalResult = await evaluateResults(
      this.query,
      results,
      tierToLlmConfig(this.modelTier.large),
      warning,
    )

    const validIndices = evalResult.selectedIndices.filter(
      (idx) => idx >= 0 && idx < results.length,
    )
    this.selectedForRead = validIndices.map((idx) => results[idx])
    this.outline = evalResult.outline
    this.sitemapHints = evalResult.sitemapHints || []
    this.githubHints = evalResult.githubHints || []
    this.phaseLog.push(
      `evaluated: selected ${this.selectedForRead.length} URLs for deep reading`,
    )
    this.emit("evaluate", "done", evalResult)
    return null
  }

  private async stepDeepRead(): Promise<null> {
    if (this.selectedForRead.length === 0) return null

    const urlsToRead = this.mode === "quick"
      ? this.selectedForRead.slice(0, 3)
      : this.selectedForRead

    const config = loadConfig()
    const deepResults = await deepReadUrls(urlsToRead, {
      xbrowserEnabled: config.searchPipeline?.sources.xbrowser.enabled ?? false,
      xbrowserCdp: config.searchPipeline?.sources.xbrowser.cdpEndpoint,
      xbrowserHeadless: config.searchPipeline?.sources.xbrowser.headless,
    })

    const successful = deepResults.filter((r) => r.success)
    this.deepReadResults = deepResults
    this.phaseLog.push(`deep-read: ${successful.length}/${deepResults.length} URLs read successfully`)
    return null
  }

  private async stepEvaluateDepth(warning: string): Promise<StepDecision> {
    const result = await evaluateDepth(
      this.query,
      this.deepReadResults,
      this.outline,
      this.mode,
      tierToLlmConfig(this.modelTier.large),
      warning,
    )

    this.qualityScore = result.qualityScore
    this.coverageScore = result.coverageScore
    if (result.updatedOutline) {
      this.outline = result.updatedOutline
    }
    if (result.missingTopics?.length) {
      this.missingTopics = result.missingTopics
    }

    const gapInfo = result.missingTopics?.length
      ? ` (missing: ${result.missingTopics.join(", ")})`
      : ""
    this.phaseLog.push(
      `depth-eval: quality=${result.qualityScore}/10, coverage=${result.coverageScore}/10, decision=${result.decision}${gapInfo}`,
    )
    this.emit("evaluate_depth", "done", result)

    if (this.budget.shouldWarn()) {
      return "done"
    }

    return result.decision as StepDecision
  }

  private async stepCheckSitemap(): Promise<StepDecision> {
    const hints = this.sitemapHints.length > 0
      ? this.sitemapHints
      : this.extractDocSiteUrls()

    if (hints.length === 0) {
      this.phaseLog.push("sitemap: no doc site candidates found")
      this.sitemapResult = { isDocSite: false, sitemapUrl: null, relevantPaths: [], priority: [] }
      return null
    }

    this.sitemapResult = await checkSitemap(hints, this.collectedSearchResults, this.query)

    if (!this.sitemapResult.isDocSite || this.sitemapResult.relevantPaths.length === 0) {
      this.phaseLog.push("sitemap: no relevant paths found")
      return null
    }

    const base = this.sitemapResult.sitemapUrl?.replace(/\/sitemap.*$/, "") || hints[0]
    const paths = this.sitemapResult.relevantPaths.slice(0, 15)
    const urls = paths.map(p => ({ title: p.split("/").pop() || p, url: `${base}${p}`, snippet: "", source: "sitemap", sourceType: "official", qualityScore: 90 }))

    this.phaseLog.push(`sitemap: found ${this.sitemapResult.relevantPaths.length} paths, deep-reading ${urls.length}`)

    const config = loadConfig()
    const sitemapDR = await deepReadUrls(urls, {
      xbrowserEnabled: config.searchPipeline?.sources.xbrowser.enabled ?? false,
      xbrowserCdp: config.searchPipeline?.sources.xbrowser.cdpEndpoint,
      xbrowserHeadless: config.searchPipeline?.sources.xbrowser.headless,
    })

    const successful = sitemapDR.filter(r => r.success)
    this.deepReadResults.push(...successful)
    this.phaseLog.push(`sitemap deep-read: ${successful.length}/${sitemapDR.length} pages read`)

    return successful.length > 3 ? "done" : null
  }

  private async stepCheckGithub(): Promise<StepDecision> {
    const hints = this.githubHints.length > 0
      ? this.githubHints
      : this.extractGithubUrls()

    if (hints.length === 0) {
      this.phaseLog.push("github: no repo candidates found")
      this.githubResult = { repoUrl: null, needsClone: false, targetPaths: [], searchKeywords: [] }
      return null
    }

    this.githubResult = await checkGithub(hints, this.collectedSearchResults, this.query)

    if (!this.githubResult.repoUrl) {
      this.phaseLog.push("github: no valid repo identified")
      return null
    }

    const paths = this.githubResult.targetPaths.slice(0, 10)
    this.phaseLog.push(`github: found ${this.githubResult.repoUrl}, reading ${paths.length} files: ${paths.join(", ")}`)

    const results: DeepReadItem[] = []
    for (const p of paths) {
      const content = await fetchGitHubFile(this.githubResult.repoUrl, p)
      if (content && content.length > 50) {
        results.push({
          title: `${this.githubResult.repoUrl}/${p}`,
          url: `${this.githubResult.repoUrl}/blob/main/${p}`,
          content: content.slice(0, 15000),
          success: true,
          source: "github",
        })
      }
    }

    const successful = results.filter(r => r.success)
    this.deepReadResults.push(...successful)
    this.phaseLog.push(`github: ${successful.length}/${paths.length} files read`)

    return null
  }

  private extractDocSiteUrls(): string[] {
    const urls: string[] = []
    for (const r of this.collectedSearchResults) {
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

  private extractGithubUrls(): string[] {
    const urls: string[] = []
    const pattern = /github\.com\/([^/]+\/[^/]+)/
    for (const r of this.collectedSearchResults) {
      const m = r.url.match(pattern)
      if (m) {
        const repo = `https://github.com/${m[1]}`
        if (!urls.includes(repo)) urls.push(repo)
      }
    }
    return urls.slice(0, 3)
  }

  private async doSynthesize(): Promise<string> {
    const hasDeepRead = this.deepReadResults.filter((r) => r.success).length > 0

    if (hasDeepRead) {
      const result = await synthesize(
        this.query,
        this.deepReadResults,
        this.outline,
        tierToLlmConfig(this.modelTier.large),
        this.qualityScore,
        this.coverageScore,
      )

      if (result.isFallback) {
        this.phaseLog.push("synthesize: LLM failed, using content fallback")
      } else {
        this.phaseLog.push("synthesize: done")
      }

      return result.text
    }

    const topResults = this.filteredResults.length > 0
      ? this.filteredResults.slice(0, 10)
      : this.collectedSearchResults.slice(0, 10)

    if (topResults.length === 0) {
      return "未能获取到相关内容。"
    }

    const contextText = topResults
      .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet.slice(0, 400)}`)
      .join("\n\n")

    try {
      const { callLlm } = await import("../search/llm-caller.js")
      const summary = await callLlm(
        tierToLlmConfig(this.modelTier.large),
        [
          { role: "system", content: "You are a research assistant. Provide concise, well-structured answers. Answer in the same language as the query." },
          {
            role: "user",
            content: `Based on these search result snippets about "${this.query}":\n\n${contextText}\n\nProvide a concise answer summarizing the key information. Include [1], [2] etc. citations. Answer in the same language as the query.`,
          },
        ],
        0.3,
        2000,
        60000,
      )

      if (summary && summary.trim().length >= 50) {
        this.phaseLog.push("synthesize: done (from snippets)")
        return summary.trim()
      }
    } catch {
      this.phaseLog.push("synthesize: LLM failed, using search result summary")
    }

    return topResults
      .map((r, i) => `[${i + 1}] **${r.title}**\n${r.url}\n${r.snippet.slice(0, 300)}`)
      .join("\n\n")
  }

  private buildFallbackSummary(): string {
    if (this.deepReadResults.length > 0) {
      return this.deepReadResults
        .filter((r) => r.success)
        .map((r, i) => {
          const lines = r.content
            .slice(0, 800)
            .split("\n")
            .filter((l) => l.trim().length > 20)
            .slice(0, 5)
            .join("\n")
          return `### [${i + 1}] ${r.title}\n来源: ${r.url}\n\n${lines}`
        })
        .join("\n\n---\n\n")
    }

    if (this.collectedSearchResults.length > 0) {
      return this.collectedSearchResults
        .slice(0, 10)
        .map((r, i) => `[${i + 1}] **${r.title}**\n${r.url}\n${r.snippet.slice(0, 200)}`)
        .join("\n\n")
    }

    return "未能获取到相关内容。"
  }

  private emit(step: StepName, status: "pending" | "running" | "done" | "skipped" | "failed", output?: unknown) {
    const progress: ResearchProgress = {
      step,
      status,
      budget: this.budget.getBudget(),
      output,
      timestamp: Date.now(),
    }
    this.progressLog.push(progress)
    this.onProgress(progress)
  }

  private calibrateScore(summary: string, drResults: DeepReadItem[]): { quality: number; coverage: number } {
    const len = summary.length
    const drSuccess = drResults.filter(r => r.success).length
    const drTotal = drResults.length
    const drRate = drTotal > 0 ? drSuccess / drTotal : 0
    const hasHeadings = (summary.match(/^#{1,3}\s/gm) || []).length
    const hasCode = summary.includes("```")
    const hasTable = summary.includes("|") && summary.includes("---")
    const hasCitations = (summary.match(/\[\d+\]/g) || []).length >= 3

    let quality = 3
    let coverage = 3

    if (len > 500) quality += 1
    if (len > 1500) quality += 1
    if (len > 3000) quality += 1
    if (len > 6000) quality += 1
    if (drRate >= 0.8) quality += 1
    if (drRate >= 1.0 && drTotal >= 5) quality += 1
    if (hasHeadings >= 4) coverage += 1
    if (hasCode) coverage += 1
    if (hasTable) coverage += 1
    if (hasCitations) coverage += 1
    if (drTotal >= 5 && drRate >= 0.7) coverage += 1
    if (drRate >= 1.0 && drTotal >= 4) coverage += 1
    if (len < 800) { quality = Math.min(quality, 4); coverage = Math.min(coverage, 3) }

    return {
      quality: Math.min(10, quality),
      coverage: Math.min(10, coverage),
    }
  }

  private appendReferences(summary: string): string {
    const allSources = [
      ...this.deepReadResults.filter(r => r.success).map((r, i) => ({
        idx: i + 1, title: r.title, url: r.url,
      })),
      ...this.collectedSearchResults.slice(0, 5).map((r, i) => ({
        idx: this.deepReadResults.filter(d => d.success).length + i + 1,
        title: r.title, url: r.url,
      })),
    ]

    if (allSources.length === 0) return summary
    if (summary.includes("## 参考资料") || summary.includes("## References")) return summary

    const refLines = allSources.slice(0, 10).map(s => `- [${s.idx}] [${s.title}](${s.url})`)
    return `${summary}\n\n---\n\n## 参考资料\n\n${refLines.join("\n")}`
  }

  private buildResult(summary: string, fallback: boolean): ResearchResult {
    const enrichedSummary = this.appendReferences(summary)
    const calibrated = this.calibrateScore(enrichedSummary, this.deepReadResults)
    const useSystemScore = this.qualityScore > 0 && !fallback
    const quality = useSystemScore
      ? Math.round((this.qualityScore + calibrated.quality) / 2)
      : calibrated.quality
    const coverage = useSystemScore
      ? Math.round((this.coverageScore + calibrated.coverage) / 2)
      : calibrated.coverage

    return {
      query: this.query,
      mode: this.mode,
      summary: enrichedSummary,
      summaryFallback: fallback,
      outline: this.outline,
      sources: this.deepReadResults
        .filter((r) => r.success)
        .map((r) => ({ title: r.title, url: r.url })),
      searchResults: this.collectedSearchResults.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
        source: r.source,
        sourceType: r.sourceType,
        qualityScore: r.qualityScore,
      })),
      deepReadResults: this.deepReadResults,
      progressLog: this.progressLog,
      phaseLog: this.phaseLog,
      durationMs: Date.now() - this.startTime,
      totalSteps: this.progressLog.filter((p) => p.status === "done").length,
      finalQualityScore: quality,
      finalCoverageScore: coverage,
    }
  }
}
