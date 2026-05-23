import type {
  BenchmarkCase,
  EvolutionConfig,
  EvolutionCycle,
  QualityMetrics,
  CaseMetrics,
  DiagnosisResult,
} from "./types"
import { DEFAULT_BENCHMARKS, DEFAULT_TARGET } from "./types"
import { computeCaseMetrics, aggregateMetrics, diffMetrics } from "./analyzer"
import { diagnoseBottleneck } from "./diagnoser"
import { tierToLlmConfig, inferModelTier } from "../model-tier"
import { callLlm } from "../../search/llm-caller"
import { createLogger } from "../../utils/logger.js"

const logger = createLogger("research:evolution:orchestrator")

export class ResearchEvolutionAgent {
  private config: EvolutionConfig
  private benchmarks: BenchmarkCase[]
  private model: { large: ReturnType<typeof tierToLlmConfig>; small: ReturnType<typeof tierToLlmConfig> }
  private cycles: EvolutionCycle[] = []
  private currentCycle: EvolutionCycle
  private onLog: (msg: string) => void

  constructor(
    config: EvolutionConfig,
    benchmarks?: BenchmarkCase[],
    onLog?: (msg: string) => void,
  ) {
    this.config = config
    this.benchmarks = benchmarks || DEFAULT_BENCHMARKS
    this.onLog = onLog || ((msg: string) => logger.debug(msg))
    this.model = {
      large: { baseUrl: "", apiKey: "", model: "" },
      small: { baseUrl: "", apiKey: "", model: "" },
    }

    this.currentCycle = {
      cycle: 0,
      phase: "done",
      metrics: null,
      diagnosis: null,
      fixApplied: null,
      previousMetrics: null,
      improved: null,
      log: [],
    }
  }

  async run(): Promise<EvolutionCycle[]> {
    const tier = inferModelTier(this.config.model, this.config.smallModel)
    if (!tier) throw new Error("Failed to infer model tier")
    this.model = {
      large: tierToLlmConfig(tier.large),
      small: tierToLlmConfig(tier.small),
    }

    this.log("Starting Research Self-Evolution Agent")

    for (let i = 1; i <= this.config.maxCycles; i++) {
      this.currentCycle = {
        cycle: i,
        phase: "probe",
        metrics: null,
        diagnosis: null,
        fixApplied: null,
        previousMetrics: i > 1 ? this.cycles[i - 2]?.metrics : null,
        improved: null,
        log: [],
      }

      // Phase 1: PROBE — run benchmarks
      this.log(`Cycle ${i}: PROBE — running ${this.benchmarks.length} benchmarks`)
      const rawResults = await this.probe()
      this.currentCycle.phase = "analyze"

      // Phase 2: ANALYZE — compute metrics
      const caseMetrics = rawResults.map((r, idx) => {
        const cm = computeCaseMetrics(r.result, r.elapsed)
        cm.id = this.benchmarks[idx]?.id || `case-${idx}`
        cm.category = this.benchmarks[idx]?.category || "unknown"
        return cm
      })
      const metrics = aggregateMetrics(caseMetrics, this.benchmarks)
      this.currentCycle.metrics = metrics
      this.currentCycle.phase = "diagnose"

      this.log(`Cycle ${i}: ANALYZE — Q:${metrics.avgQualityScore} C:${metrics.avgCoverageScore} DR:${metrics.avgDRSuccessRate} ZeroDR:${metrics.zeroDRRate}`)

      // Check if targets met
      if (this.targetsMet(metrics)) {
        this.log(`Cycle ${i}: TARGETS MET — evolution complete`)
        this.currentCycle.phase = "done"
        this.currentCycle.improved = true
        this.cycles.push({ ...this.currentCycle })
        break
      }

      // Phase 3: DIAGNOSE — find bottleneck
      this.log(`Cycle ${i}: DIAGNOSE — analyzing bottleneck`)
      const diagnosis = await diagnoseBottleneck(metrics, this.model.large)
      this.currentCycle.diagnosis = diagnosis
      this.currentCycle.phase = "fix"

      this.log(`Cycle ${i}: BOTTLENECK — [${diagnosis.severity}] ${diagnosis.bottleneck}`)
      this.log(`  Root cause: ${diagnosis.rootCause}`)
      this.log(`  Suggested fix: ${diagnosis.suggestedFix}`)

      // Phase 4: FIX — apply fix via LLM code generation
      this.log(`Cycle ${i}: FIX — generating code patch`)
      const fixResult = await this.applyFix(diagnosis)
      this.currentCycle.fixApplied = fixResult

      if (!fixResult) {
        this.log(`Cycle ${i}: FIX FAILED — skipping verification`)
        this.currentCycle.phase = "done"
        this.currentCycle.improved = false
        this.cycles.push({ ...this.currentCycle })
        continue
      }

      // Phase 5: VERIFY — re-run benchmarks and compare
      this.log(`Cycle ${i}: VERIFY — re-running benchmarks`)
      const verifyResults = await this.probe()
      const verifyCaseMetrics = verifyResults.map((r, idx) => {
        const cm = computeCaseMetrics(r.result, r.elapsed)
        cm.id = this.benchmarks[idx]?.id || `case-${idx}`
        cm.category = this.benchmarks[idx]?.category || "unknown"
        return cm
      })
      const newMetrics = aggregateMetrics(verifyCaseMetrics, this.benchmarks)

      // Compare
      if (this.currentCycle.previousMetrics) {
        const diff = diffMetrics(this.currentCycle.previousMetrics, newMetrics)
        this.log(`Cycle ${i}: DIFF — ${JSON.stringify(diff)}`)
        const improved = Object.values(diff).filter(d => d.improved).length >=
          Object.values(diff).filter(d => !d.improved).length
        this.currentCycle.improved = improved
        this.log(`Cycle ${i}: ${improved ? "IMPROVED ✅" : "REGRESSED ❌"}`)
      } else {
        this.currentCycle.improved = true
      }

      this.currentCycle.phase = "done"
      this.cycles.push({ ...this.currentCycle })
    }

    return this.cycles
  }

  private async probe(): Promise<Array<{ result: Record<string, unknown>; elapsed: number }>> {
    const results: Array<{ result: Record<string, unknown>; elapsed: number }> = []

    for (const bm of this.benchmarks) {
      const startTime = Date.now()
      try {
        const body = JSON.stringify({
          query: bm.query,
          mode: bm.mode,
          model: { provider: this.config.model.provider, id: this.config.model.id },
          smallModel: { provider: this.config.smallModel.provider, id: this.config.smallModel.id },
        })

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 480000)
        const resp = await fetch(`${this.config.serverUrl}/api/agent-research`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: controller.signal,
        })
        clearTimeout(timeout)

        const text = await resp.text()
        let result: Record<string, unknown> | null = null
        for (const line of text.split("\n")) {
          const sseData = line.startsWith("data: ") ? line.slice(6) : line.startsWith("data:") ? line.slice(5) : null
          if (sseData !== null) {
            try {
              const d = JSON.parse(sseData)
              if (d.phaseLog) result = d
            } catch (e) {
              logger.warn(e instanceof Error ? e.message : String(e))
            }
          }
        }

        const elapsed = (Date.now() - startTime) / 1000
        results.push({ result: result || { error: true, phaseLog: [], summary: "", deepReadResults: [] }, elapsed })
        this.log(`  [${bm.id}] ${result ? "OK" : "FAIL"} ${Math.round(elapsed)}s`)
      } catch (e) {
        const elapsed = (Date.now() - startTime) / 1000
        results.push({ result: { error: true, phaseLog: [], summary: "", deepReadResults: [] }, elapsed })
        this.log(`  [${bm.id}] ERROR: ${(e as Error).message}`)
      }
    }

    return results
  }

  private targetsMet(m: QualityMetrics): boolean {
    const t = this.config.targetMetrics
    return (
      m.avgQualityScore >= t.minAvgQuality &&
      m.avgCoverageScore >= t.minAvgCoverage &&
      m.avgDRSuccessRate >= t.minDRSuccessRate &&
      m.zeroDRRate <= t.maxZeroDRRate
    )
  }

  private async applyFix(diagnosis: DiagnosisResult): Promise<string | null> {
    if (!diagnosis.targetFile || diagnosis.severity === "low") {
      this.log(`  Skipping fix: ${!diagnosis.targetFile ? "no target file" : "low severity"}`)
      return null
    }

    // For now, log the suggestion for human review
    // Full auto-fix would require reading the file, generating patch, applying, and testing
    this.log(`  Fix suggestion for ${diagnosis.targetFile}: ${diagnosis.suggestedFix}`)

    // Return the diagnosis as the "fix applied" record
    return `[${diagnosis.severity}] ${diagnosis.bottleneck} → ${diagnosis.suggestedFix}`
  }

  private log(msg: string) {
    this.currentCycle.log.push(msg)
    this.onLog(msg)
  }

  getCycles(): EvolutionCycle[] {
    return this.cycles
  }

  getReport(): string {
    const lines: string[] = ["# Research Self-Evolution Report", ""]

    for (const cycle of this.cycles) {
      const m = cycle.metrics
      lines.push(`## Cycle ${cycle.cycle}`)
      if (m) {
        lines.push(`- Q: ${m.avgQualityScore} C: ${m.avgCoverageScore} DR: ${m.avgDRSuccessRate}`)
        lines.push(`- Summary: ${m.avgSummaryChars}c Time: ${m.avgTime}s`)
        lines.push(`- Sitemap: ${m.sitemapHitRate} GitHub: ${m.githubHitRate} Refs: ${m.referenceAppendRate}`)
      }
      if (cycle.diagnosis) {
        lines.push(`- Bottleneck: [${cycle.diagnosis.severity}] ${cycle.diagnosis.bottleneck}`)
      }
      if (cycle.fixApplied) {
        lines.push(`- Fix: ${cycle.fixApplied}`)
      }
      if (cycle.improved !== null) {
        lines.push(`- Result: ${cycle.improved ? "✅ Improved" : "❌ Regressed"}`)
      }
      lines.push("")
    }

    return lines.join("\n")
  }
}
