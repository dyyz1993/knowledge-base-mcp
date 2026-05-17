/**
 * Research Self-Evolution Agent
 *
 * 自动执行 "发现问题 → 诊断根因 → 修复 → 验证" 循环，
 * 持续提升 research 系统的输出质量。
 *
 * 核心循环：
 * 1. PROBE: 跑 benchmark 测试场景
 * 2. ANALYZE: 多维度分析质量瓶颈
 * 3. DIAGNOSE: LLM 定位根因 + 生成修复方案
 * 4. FIX: 自动修改代码 + 编译验证
 * 5. VERIFY: 重跑测试，对比前后质量
 * 6. 循环直到质量达标或预算用完
 */

export interface BenchmarkCase {
  id: string
  query: string
  mode: "quick" | "standard"
  category: string
  minExpectedChars: number
  minExpectedDR: number
}

export interface QualityMetrics {
  avgSummaryChars: number
  avgQualityScore: number
  avgCoverageScore: number
  avgDRSuccessRate: number
  avgLoops: number
  avgTime: number
  sitemapHitRate: number
  githubHitRate: number
  referenceAppendRate: number
  fallbackRate: number
  zeroDRRate: number
  perCase: CaseMetrics[]
}

export interface CaseMetrics {
  id: string
  category: string
  summaryChars: number
  qualityScore: number
  coverageScore: number
  drSuccess: number
  drTotal: number
  drRate: number
  steps: number
  loops: number
  timeSec: number
  hasSitemap: boolean
  hasGithub: boolean
  hasReferences: boolean
  fallback: boolean
  sources: Record<string, number>
}

export interface DiagnosisResult {
  bottleneck: string
  severity: "critical" | "high" | "medium" | "low"
  rootCause: string
  suggestedFix: string
  targetFile: string
  targetCode?: string
}

export interface EvolutionCycle {
  cycle: number
  phase: "probe" | "analyze" | "diagnose" | "fix" | "verify" | "done"
  metrics: QualityMetrics | null
  diagnosis: DiagnosisResult | null
  fixApplied: string | null
  previousMetrics: QualityMetrics | null
  improved: boolean | null
  log: string[]
}

export interface EvolutionConfig {
  maxCycles: number
  serverUrl: string
  model: { provider: string; id: string }
  smallModel: { provider: string; id: string }
  targetMetrics: {
    minAvgQuality: number
    minAvgCoverage: number
    minDRSuccessRate: number
    maxZeroDRRate: number
  }
}

export const DEFAULT_BENCHMARKS: BenchmarkCase[] = [
  { id: "quick-react19", query: "React 19 新特性完整列表", mode: "quick", category: "quick", minExpectedChars: 1500, minExpectedDR: 1 },
  { id: "tutorial-deploy", query: "Node.js 生产环境部署最佳实践：性能优化和安全加固", mode: "standard", category: "tutorial", minExpectedChars: 3000, minExpectedDR: 4 },
  { id: "compare-runtimes", query: "Bun 和 Deno 运行时全面对比", mode: "standard", category: "comparison", minExpectedChars: 2000, minExpectedDR: 3 },
  { id: "concept-wasm", query: "Rust WebAssembly 应用前景和技术路线", mode: "standard", category: "concept", minExpectedChars: 2000, minExpectedDR: 3 },
  { id: "troubleshoot-ts", query: "TypeScript TS2307 Cannot find module 错误排查", mode: "standard", category: "troubleshooting", minExpectedChars: 2000, minExpectedDR: 3 },
]

export const DEFAULT_TARGET: EvolutionConfig["targetMetrics"] = {
  minAvgQuality: 7,
  minAvgCoverage: 7,
  minDRSuccessRate: 0.8,
  maxZeroDRRate: 0,
}
