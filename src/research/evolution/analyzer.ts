import type { BenchmarkCase, CaseMetrics, QualityMetrics } from "./types"

export function computeCaseMetrics(result: Record<string, unknown>, elapsed: number): CaseMetrics {
  const pl = (result.phaseLog || []) as string[]
  const dr = (result.deepReadResults || []) as Array<{ success: boolean; source: string }>
  const summary = String(result.summary || "")

  const sources: Record<string, number> = {}
  for (const r of dr) {
    const s = r.source || "?"
    sources[s] = (sources[s] || 0) + 1
  }

  let quality = 0, coverage = 0, loops = 0
  for (const p of pl) {
    const qm = p.match(/quality=(\d+)/)
    const cm = p.match(/coverage=(\d+)/)
    if (qm && cm) {
      quality = Number(qm[1])
      coverage = Number(cm[1])
      loops++
    }
  }

  const hasSitemap = pl.some(p => p.includes("sitemap") && p.includes("deep-reading"))
  const hasGithub = pl.some(p => p.includes("github") && p.includes("reading"))
  const hasReferences = summary.includes("## 参考资料")

  return {
    id: String(result.query || "").slice(0, 20),
    category: "",
    summaryChars: summary.length,
    qualityScore: Number(result.finalQualityScore) || quality,
    coverageScore: Number(result.finalCoverageScore) || coverage,
    drSuccess: dr.filter(r => r.success).length,
    drTotal: dr.length,
    drRate: dr.length > 0 ? dr.filter(r => r.success).length / dr.length : 0,
    steps: pl.length,
    loops,
    timeSec: Math.round(elapsed),
    hasSitemap,
    hasGithub,
    hasReferences,
    fallback: Boolean(result.summaryFallback),
    sources,
  }
}

export function aggregateMetrics(cases: CaseMetrics[], benchmarks: BenchmarkCase[]): QualityMetrics {
  // Attach category from benchmark
  for (const c of cases) {
    const bm = benchmarks.find(b => c.id.includes(b.query.slice(0, 10)) || b.id.startsWith(c.category))
    if (bm) c.category = bm.category
  }

  const n = cases.length || 1
  const avg = (fn: (c: CaseMetrics) => number) => cases.reduce((s, c) => s + fn(c), 0) / n

  return {
    avgSummaryChars: Math.round(avg(c => c.summaryChars)),
    avgQualityScore: Math.round(avg(c => c.qualityScore) * 10) / 10,
    avgCoverageScore: Math.round(avg(c => c.coverageScore) * 10) / 10,
    avgDRSuccessRate: Math.round(avg(c => c.drRate) * 100) / 100,
    avgLoops: Math.round(avg(c => c.loops) * 10) / 10,
    avgTime: Math.round(avg(c => c.timeSec)),
    sitemapHitRate: cases.filter(c => c.hasSitemap).length / n,
    githubHitRate: cases.filter(c => c.hasGithub).length / n,
    referenceAppendRate: cases.filter(c => c.hasReferences).length / n,
    fallbackRate: cases.filter(c => c.fallback).length / n,
    zeroDRRate: cases.filter(c => c.drTotal === 0).length / n,
    perCase: cases,
  }
}

export function diffMetrics(before: QualityMetrics, after: QualityMetrics): Record<string, { before: number; after: number; delta: number; improved: boolean }> {
  const keys = [
    "avgSummaryChars", "avgQualityScore", "avgCoverageScore",
    "avgDRSuccessRate", "sitemapHitRate", "githubHitRate",
    "referenceAppendRate", "fallbackRate", "zeroDRRate",
  ] as const

  const result: Record<string, { before: number; after: number; delta: number; improved: boolean }> = {}
  for (const k of keys) {
    const b = before[k] as number
    const a = after[k] as number
    const delta = Math.round((a - b) * 100) / 100
    // For fallbackRate and zeroDRRate, lower is better
    const lowerBetter = k === "fallbackRate" || k === "zeroDRRate"
    result[k] = { before: b, after: a, delta, improved: lowerBetter ? delta < 0 : delta > 0 }
  }
  return result
}
