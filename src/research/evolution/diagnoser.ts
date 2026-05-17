import type { QualityMetrics, DiagnosisResult } from "./types"
import { callLlm } from "../../search/llm-caller"
import type { LlmConfig } from "../../search/llm-caller"

export async function diagnoseBottleneck(
  metrics: QualityMetrics,
  model: LlmConfig,
): Promise<DiagnosisResult> {
  const metricsText = JSON.stringify({
    avgSummaryChars: metrics.avgSummaryChars,
    avgQualityScore: metrics.avgQualityScore,
    avgCoverageScore: metrics.avgCoverageScore,
    avgDRSuccessRate: metrics.avgDRSuccessRate,
    avgLoops: metrics.avgLoops,
    avgTime: metrics.avgTime,
    sitemapHitRate: metrics.sitemapHitRate,
    githubHitRate: metrics.githubHitRate,
    referenceAppendRate: metrics.referenceAppendRate,
    fallbackRate: metrics.fallbackRate,
    zeroDRRate: metrics.zeroDRRate,
    perCase: metrics.perCase.map(c => ({
      category: c.category,
      summaryChars: c.summaryChars,
      qualityScore: c.qualityScore,
      coverageScore: c.coverageScore,
      drSuccess: c.drSuccess,
      drTotal: c.drTotal,
      drRate: c.drRate,
      hasSitemap: c.hasSitemap,
      hasGithub: c.hasGithub,
      hasReferences: c.hasReferences,
      fallback: c.fallback,
      sources: c.sources,
    })),
  }, null, 2)

  const prompt = `You are a research system quality engineer. Analyze these metrics from a research pipeline that searches the web, deep-reads pages, and synthesizes structured summaries.

METRICS:
${metricsText}

TARGET: avgQuality >= 7, avgCoverage >= 7, DR success rate >= 0.8, zero DR rate = 0

SOURCE CODE FILES (you can suggest changes to these):
- src/research/steps/analyze-query.ts — query analysis, generates subQueries
- src/research/steps/deep-read.ts — URL deep reading with xbrowser + fetch fallback
- src/research/steps/evaluate.ts — selects URLs for deep reading
- src/research/steps/evaluate-depth.ts — quality scoring, gap detection
- src/research/steps/synthesize.ts — final summary generation
- src/research/steps/check-sitemap.ts — official doc site crawling
- src/research/steps/check-github.ts — GitHub repo reading
- src/research/research-agent.ts — main orchestration loop
- src/research/types.ts — flow definitions, budgets

Identify the SINGLE most impactful bottleneck. Return ONLY a JSON object:
{
  "bottleneck": "one-line description",
  "severity": "critical|high|medium|low",
  "rootCause": "why this is happening",
  "suggestedFix": "what to change, be specific about which file and what logic",
  "targetFile": "src/research/steps/xxx.ts"
}`

  const raw = await callLlm(
    model,
    [
      { role: "system", content: "You are a senior TypeScript engineer. Output ONLY valid JSON." },
      { role: "user", content: prompt },
    ],
    0.3,
    1000,
    60000,
  )

  // Extract JSON
  const match = raw.match(/\{[\s\S]*"bottleneck"[\s\S]*\}/)
  if (!match) {
    return {
      bottleneck: "Failed to parse diagnosis",
      severity: "low",
      rootCause: raw.slice(0, 200),
      suggestedFix: "Review manually",
      targetFile: "",
    }
  }

  try {
    return JSON.parse(match[0]) as DiagnosisResult
  } catch {
    return {
      bottleneck: "JSON parse failed",
      severity: "low",
      rootCause: match[0].slice(0, 200),
      suggestedFix: "Review manually",
      targetFile: "",
    }
  }
}
