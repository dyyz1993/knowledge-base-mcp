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
import { loadConfig } from "../config"
import type { SearchResult } from "../search/types"

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

        if (decision === "done" || stepName === "synthesize") {
          const summary = stepName === "synthesize"
            ? await this.doSynthesize()
            : await this.doSynthesize()
          return this.buildResult(summary, false)
        }

        if (decision === "need_more_search") {
          i = this.findStepIndex(flow, "analyze_query")
          if (i >= 0) {
            this.phaseLog.push("looping back: re-searching with new keywords")
            i++
            continue
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
    if (stepName === "check_github" || stepName === "clone_index" || stepName === "code_search") {
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

    if (sources.length === 0) {
      this.phaseLog.push("search: no sources available")
      return null
    }

    const { SearchPipeline } = await import("../search/search-pipeline.js")
    const pipeline = new SearchPipeline(sources)

    const analyzeOutput = this.progressLog.find(
      (p) => p.step === "analyze_query" && p.status === "done",
    )?.output as { subQueries?: string[] } | undefined

    const queries = analyzeOutput?.subQueries?.length
      ? analyzeOutput.subQueries.slice(0, 5)
      : [this.query]

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
    this.phaseLog.push(
      `evaluated: selected ${this.selectedForRead.length} URLs for deep reading`,
    )
    this.emit("evaluate", "done", evalResult)
    return null
  }

  private async stepDeepRead(): Promise<null> {
    if (this.selectedForRead.length === 0) return null

    const config = loadConfig()
    const deepResults = await deepReadUrls(this.selectedForRead, {
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

    this.phaseLog.push(
      `depth-eval: quality=${result.qualityScore}/10, coverage=${result.coverageScore}/10, decision=${result.decision}`,
    )
    this.emit("evaluate_depth", "done", result)

    if (this.budget.shouldWarn()) {
      return "done"
    }

    return result.decision as StepDecision
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

  private buildResult(summary: string, fallback: boolean): ResearchResult {
    return {
      query: this.query,
      mode: this.mode,
      summary,
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
      finalQualityScore: this.qualityScore,
      finalCoverageScore: this.coverageScore,
    }
  }
}
