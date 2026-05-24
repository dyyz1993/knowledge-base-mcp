import type { ResearchResult, ResearchMode, DeepReadItem } from "./types"
import type { SearchResult } from "../search/types"
import { synthesize } from "./steps/synthesize"
import { tierToLlmConfig } from "./model-tier"
import type { ModelTier } from "./types"

export async function doSynthesize(
  query: string,
  mode: ResearchMode,
  modelTier: ModelTier,
  deepReadResults: DeepReadItem[],
  filteredResults: SearchResult[],
  collectedSearchResults: SearchResult[],
  outline: string,
  qualityScore: number,
  coverageScore: number,
  researchType: string,
  startTime: number,
  maxDurationMs: number,
  phaseLog: string[],
): Promise<string> {
  const hasDeepRead = deepReadResults.filter((r) => r.success).length > 0

  if (hasDeepRead) {
    const remainingMs = maxDurationMs > 0
      ? maxDurationMs - (Date.now() - startTime)
      : undefined
    const result = await synthesize(
      query,
      deepReadResults,
      outline,
      tierToLlmConfig(modelTier.large),
      qualityScore,
      coverageScore,
      researchType,
      remainingMs && remainingMs > 0 ? remainingMs : undefined,
    )

    if (result.isFallback) {
      phaseLog.push("synthesize: LLM failed, using content fallback")
    } else {
      phaseLog.push("synthesize: done")
    }

    return result.text
  }

  const topResults = filteredResults.length > 0
    ? filteredResults.slice(0, 10)
    : collectedSearchResults.slice(0, 10)

  if (topResults.length === 0) {
    const isZh = /[\u4e00-\u9fff]/.test(query)
    return isZh ? "未能获取到相关内容。" : "No relevant content found."
  }

  const contextText = topResults
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet.slice(0, 400)}`)
    .join("\n\n")

  try {
    const { callLlm } = await import("../search/llm-caller.js")
    const summary = await callLlm(
      tierToLlmConfig(modelTier.large),
      [
        { role: "system", content: "You are a research assistant. Provide concise, well-structured answers. Answer in the same language as the query." },
        {
          role: "user",
          content: `Based on these search result snippets about "${query}":\n\n${contextText}\n\nProvide a concise answer summarizing the key information. Include [1], [2] etc. citations. Answer in the same language as the query.`,
        },
      ],
      0.3,
      2000,
      60000,
    )

    if (summary && summary.trim().length >= 50) {
      phaseLog.push("synthesize: done (from snippets)")
      return summary.trim()
    }
  } catch {
    phaseLog.push("synthesize: LLM failed, using search result summary")
  }

  return topResults
    .map((r, i) => `[${i + 1}] **${r.title}**\n${r.url}\n${r.snippet.slice(0, 300)}`)
    .join("\n\n")
}

export function buildFallbackSummary(query: string, deepReadResults: DeepReadItem[], collectedSearchResults: SearchResult[]): string {
  const isZh = /[\u4e00-\u9fff]/.test(query)
  const sourceLabel = isZh ? "来源" : "Source"
  if (deepReadResults.length > 0) {
    return deepReadResults
      .filter((r) => r.success)
      .map((r, i) => {
        const lines = r.content
          .slice(0, 800)
          .split("\n")
          .filter((l) => l.trim().length > 20)
          .slice(0, 5)
          .join("\n")
        return `### [${i + 1}] ${r.title}\n${sourceLabel}: ${r.url}\n\n${lines}`
      })
      .join("\n\n---\n\n")
  }

  if (collectedSearchResults.length > 0) {
    return collectedSearchResults
      .slice(0, 10)
      .map((r, i) => `[${i + 1}] **${r.title}**\n${r.url}\n${r.snippet.slice(0, 200)}`)
      .join("\n\n")
  }

  return "未能获取到相关内容。"
}

export function calibrateScore(summary: string, drResults: DeepReadItem[]): { quality: number; coverage: number } {
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

export function appendReferences(summary: string, deepReadResults: DeepReadItem[], collectedSearchResults: SearchResult[]): string {
  const allSources = [
    ...deepReadResults.filter(r => r.success).map((r, i) => ({
      idx: i + 1, title: r.title, url: r.url,
    })),
    ...collectedSearchResults.slice(0, 5).map((r, i) => ({
      idx: deepReadResults.filter(d => d.success).length + i + 1,
      title: r.title, url: r.url,
    })),
  ]

  if (allSources.length === 0) return summary
  if (summary.includes("## 参考资料") || summary.includes("## References")) return summary

  const refLines = allSources.slice(0, 10).map(s => `- [${s.idx}] [${s.title}](${s.url})`)
  return `${summary}\n\n---\n\n## 参考资料\n\n${refLines.join("\n")}`
}

export function buildResult(
  query: string,
  mode: ResearchMode,
  deepReadResults: DeepReadItem[],
  collectedSearchResults: SearchResult[],
  progressLog: ResearchResult["progressLog"],
  phaseLog: string[],
  startTime: number,
  qualityScore: number,
  coverageScore: number,
  outline: string,
  summary: string,
  fallback: boolean,
): ResearchResult {
  const enrichedSummary = appendReferences(summary, deepReadResults, collectedSearchResults)
  const calibrated = calibrateScore(enrichedSummary, deepReadResults)
  const useSystemScore = qualityScore > 0 && !fallback
  const quality = useSystemScore
    ? Math.max(Math.min(qualityScore, calibrated.quality + 2), calibrated.quality - 2)
    : calibrated.quality
  const coverage = useSystemScore
    ? Math.max(Math.min(coverageScore, calibrated.coverage + 2), calibrated.coverage - 2)
    : calibrated.coverage

  return {
    query,
    mode,
    summary: enrichedSummary,
    summaryFallback: fallback,
    outline,
    sources: deepReadResults
      .filter((r) => r.success)
      .map((r) => ({ title: r.title, url: r.url })),
    searchResults: collectedSearchResults.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.source,
      sourceType: r.sourceType,
      qualityScore: r.qualityScore,
    })),
    deepReadResults,
    progressLog,
    phaseLog,
    durationMs: Date.now() - startTime,
    totalSteps: progressLog.filter((p) => p.status === "done").length,
    finalQualityScore: quality,
    finalCoverageScore: coverage,
  }
}
