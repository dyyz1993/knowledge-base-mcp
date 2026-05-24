import type {
  ResearchMode,
  ResearchResult,
  ResearchProgress,
  StepName,
  ModelTier,
  ResearchRequest,
  StepDecision,
} from "./types"
import { QUICK_FLOW, STANDARD_FLOW, DEEP_FLOW } from "./types"
import { BudgetManager } from "./budget-manager"
import { inferModelTier } from "./model-tier"
import { clearDeepReadCache } from "./steps/deep-read"
import { loadConfig } from "../config"
import {
  stepAnalyzeQuery,
  stepSearch,
  stepFilterResults,
  stepEvaluate,
  stepDeepRead,
  stepEvaluateDepth,
  stepCheckSitemap,
  stepCheckGithub,
  extractDocSiteUrls,
  extractGithubUrls,
  type StepContext,
} from "./research-agent-steps.js"
import {
  doSynthesize,
  buildFallbackSummary,
  buildResult,
} from "./research-agent-result.js"

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

  private ctx: StepContext

  private cachedConfig: ReturnType<typeof loadConfig> | null = null
  private maxDurationMs = 0

  private getConfig(): ReturnType<typeof loadConfig> {
    if (!this.cachedConfig) {
      this.cachedConfig = loadConfig()
    }
    return this.cachedConfig
  }

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

    this.ctx = {
      query: this.query,
      mode: this.mode,
      modelTier: this.modelTier,
      collectedSearchResults: [],
      filteredResults: [],
      selectedForRead: [],
      deepReadResults: [],
      outline: "",
      qualityScore: 0,
      coverageScore: 0,
      researchType: "concept",
      missingTopics: [],
      loopCount: 0,
      sitemapHints: [],
      githubHints: [],
      sitemapResult: null,
      githubResult: null,
      progressLog: this.progressLog,
      phaseLog: this.phaseLog,
    }
  }

  async run(): Promise<ResearchResult> {
    clearDeepReadCache()
    this.startTime = Date.now()
    const flow = this.getFlow()

    this.maxDurationMs = this.mode === "quick" ? 300_000 : this.mode === "standard" ? 600_000 : 1_200_000

    let timedOut = false

    let i = 0
    while (i < flow.length) {
      if (!timedOut && Date.now() - this.startTime > this.maxDurationMs) {
        timedOut = true
        this.phaseLog.push(`overall timeout reached (${this.maxDurationMs / 1000}s), forcing synthesize`)
        const summary = await this.doSynthesize()
        return this.buildResult(summary, true)
      }

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

        if (stepName === "search" && this.ctx.collectedSearchResults.length === 0) {
          this.phaseLog.push("search produced 0 results, skipping to synthesize")
          const synIdx = flow.indexOf("synthesize")
          if (synIdx >= 0) {
            i = synIdx
            continue
          }
        }

        const shouldFinalize = decision === "done"

        if (shouldFinalize || stepName === "synthesize") {
          const summary = await this.doSynthesize()
          return this.buildResult(summary, false)
        }

        if (decision === "need_more_search") {
          this.ctx.loopCount++
          if (this.ctx.loopCount > 2) {
            this.phaseLog.push("max loops reached, proceeding to synthesize")
            const synIdx = flow.indexOf("synthesize")
            if (synIdx >= 0 && synIdx > i) {
              i = synIdx
              continue
            }
          } else {
            const searchIdx = flow.indexOf("search")
            if (searchIdx >= 0) {
              const gapInfo = this.ctx.missingTopics.length
                ? ` (targeting: ${this.ctx.missingTopics.slice(0, 3).join(", ")})`
                : ""
              this.phaseLog.push(`looping back: re-searching with gap keywords${gapInfo}`)
              i = searchIdx
              continue
            }
          }
        }

        if (decision === "need_sitemap") {
          const sitemapIdx = flow.indexOf("check_sitemap")
          if (sitemapIdx >= 0 && sitemapIdx > i) {
            this.phaseLog.push("evaluate_depth suggests sitemap exploration, jumping to check_sitemap")
            i = sitemapIdx
            continue
          }
        }

        if (decision === "need_github") {
          const githubIdx = flow.indexOf("check_github")
          if (githubIdx >= 0 && githubIdx > i) {
            this.phaseLog.push("evaluate_depth suggests GitHub exploration, jumping to check_github")
            i = githubIdx
            continue
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        this.budget.refund(stepName)
        this.emit(stepName, "failed")
        this.phaseLog.push(`${stepName}: failed (${msg})`)

        if (stepName === "synthesize") {
          return this.buildResult(buildFallbackSummary(this.query, this.ctx.deepReadResults, this.ctx.collectedSearchResults), true)
        }

        if (stepName === "evaluate" && this.ctx.selectedForRead.length === 0) {
          const pool = this.ctx.filteredResults.length > 0 ? this.ctx.filteredResults : this.ctx.collectedSearchResults
          if (pool.length > 0) {
            const limit = this.mode === "quick" ? 3 : 5
            this.ctx.selectedForRead = pool
              .slice()
              .sort((a, b) => (b.qualityScore || 0) - (a.qualityScore || 0))
              .slice(0, limit)
            this.phaseLog.push(`evaluate fallback: selected top ${this.ctx.selectedForRead.length} URLs by qualityScore`)
          }
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

  private shouldSkipStep(stepName: StepName): string | null {
    if (stepName === "clone_index" || stepName === "code_search") {
      return "only available in deep flow with explicit inclusion"
    }
    return null
  }

  private async executeStep(stepName: StepName): Promise<StepDecision | null> {
    const warning = this.budget.getWarningPrompt()

    switch (stepName) {
      case "analyze_query": return stepAnalyzeQuery(this.ctx, warning)
      case "search": return stepSearch(this.ctx)
      case "filter_results": return stepFilterResults(this.ctx, warning)
      case "evaluate": return stepEvaluate(this.ctx, warning)
      case "deep_read": return stepDeepRead(this.ctx)
      case "evaluate_depth": return stepEvaluateDepth(this.ctx, warning)
      case "check_sitemap": return stepCheckSitemap(this.ctx)
      case "check_github": return stepCheckGithub(this.ctx)
      case "synthesize": return null
      default: return null
    }
  }

  private async doSynthesize(): Promise<string> {
    return doSynthesize(
      this.query,
      this.mode,
      this.modelTier,
      this.ctx.deepReadResults,
      this.ctx.filteredResults,
      this.ctx.collectedSearchResults,
      this.ctx.outline,
      this.ctx.qualityScore,
      this.ctx.coverageScore,
      this.ctx.researchType,
      this.startTime,
      this.maxDurationMs,
      this.phaseLog,
    )
  }

  private buildResult(summary: string, fallback: boolean): ResearchResult {
    return buildResult(
      this.query,
      this.mode,
      this.ctx.deepReadResults,
      this.ctx.collectedSearchResults,
      this.progressLog,
      this.phaseLog,
      this.startTime,
      this.ctx.qualityScore,
      this.ctx.coverageScore,
      this.ctx.outline,
      summary,
      fallback,
    )
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
}
