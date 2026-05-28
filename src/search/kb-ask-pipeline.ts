import { searchDocs, searchDocsCombined, readDoc, writeDoc, resolveMiss, recordMiss } from "../storage/index"
import type { DocMeta } from "../storage/index"
import { loadConfig } from "../config"
import type { SearchResult } from "./types"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("search:kb-ask-pipeline")
import {
  HIGH_RELEVANCE_SCORE,
  LOW_RELEVANCE_SCORE,
  MIN_SUMMARY_LENGTH,
  MIN_RESULTS_FOR_COMPLETE,
  MIN_CONTENT_LENGTH,
  MIN_SHORT_CONTENT_LENGTH,
  AUTO_COMPLETE_THRESHOLD,
  RRF_K,
} from "./constants"
import { resolvePiConfig, analyzeIntent } from "./ask/intent-analyzer.js"
import type { IntentAnalysis } from "./ask/intent-analyzer.js"
import { evaluateQuality } from "./ask/quality-evaluator.js"
import { buildSearchPipelineSources, searchViaPipeline } from "./ask/pipeline-sources.js"

export { buildSearchPipelineSources } from "./ask/pipeline-sources.js"

const _deps = {
  searchDocs,
  searchDocsCombined,
  readDoc,
  writeDoc,
  resolveMiss,
  recordMiss,
}

export function _setDeps(overrides: Partial<typeof _deps>) {
  Object.assign(_deps, overrides)
}

export function _resetDeps() {
  Object.assign(_deps, { searchDocs, searchDocsCombined, readDoc, writeDoc, resolveMiss, recordMiss })
}

export function getAskPipelineConfig() {
  const config = loadConfig()
  return config.askPipeline
}

export interface AskResult {
  from_kb: boolean
  id?: string
  title?: string
  score?: number
  content?: string
  quality?: "high" | "medium" | "low"
  completeness?: "complete" | "partial" | "incomplete"
  loops_used?: number
  queries_used?: string[]
  web_search_suggestion?: {
    reason: string
    search_query: string
    missing_aspects: string[]
  }
  miss?: boolean
  miss_stats?: { total_unresolved: number; recurring: boolean }
  suggested_workflow?: {
    step_1_search: string
    step_2_read: string
    step_3_store: string
  }
  alternative_workflows?: Record<string, string>
  web_results?: Array<{ id: string; title: string; url: string; source: string }>
  auto_saved?: boolean
  degraded?: boolean
  hint: string
}

export async function multiSearch(queries: string[], limit = 5): Promise<(DocMeta & { score: number; snippet?: string; matched_by: string[] })[]> {
  const seen = new Map<string, DocMeta & { score: number; snippet?: string; matched_by: string[] }>()

  for (const q of queries) {
    const results = await _deps.searchDocsCombined(q, undefined, undefined, limit)
    for (let rank = 0; rank < results.length; rank++) {
      const r = results[rank]
      const rrfScore = 1000 / (RRF_K + rank + 1)
      const existing = seen.get(r.id)
      if (existing) {
        existing.score += rrfScore
      } else {
        seen.set(r.id, { ...r, score: rrfScore, matched_by: [] })
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.score - a.score)
}

export function buildWebSearchSuggestion(
  reason: string,
  searchQuery: string,
  missingAspects: string[],
): AskResult["web_search_suggestion"] {
  return { reason, search_query: searchQuery, missing_aspects: missingAspects }
}

async function augmentWithWebSearch(
  baseResult: AskResult,
  searchQuery: string,
  maxWebResults: number,
): Promise<AskResult> {
  try {
    const webResults = await searchViaPipeline(searchQuery, maxWebResults)
    if (webResults.length > 0) {
      const savedDocs: AskResult["web_results"] = []

      for (const r of webResults) {
        savedDocs.push({ id: "", title: r.title, url: r.url, source: r.source })
      }
      baseResult.hint += ` | 🌐 已联网补充 ${webResults.length} 条结果（摘要不入库，深度研究会自动存储）`

      baseResult.web_results = savedDocs

      if (baseResult.completeness !== "complete") {
        const research = await autoResearch(searchQuery, [])
        if (research) {
          research.web_results = savedDocs
          research.hint += baseResult.hint
          return research
        }
      }
    }
  } catch {
    baseResult.degraded = true
    return baseResult
  }
  return baseResult
}

export function buildMissResponse(query: string, allQueriesUsed: string[], loopsUsed: number): AskResult {
  const miss = _deps.recordMiss(query)

  return {
    from_kb: false,
    miss: true,
    loops_used: loopsUsed,
    queries_used: allQueriesUsed,
    miss_stats: { total_unresolved: miss.total_misses, recurring: miss.recurring },
    suggested_workflow: {
      step_1_search: `web-search-prime(query="${allQueriesUsed[allQueriesUsed.length - 1] || query}")`,
      step_2_read: "web-reader(url=top_results) — 抓取页面完整内容",
      step_3_store: "kb_ingest_url(url, title, content) — 存入知识库",
    },
    alternative_workflows: {
      github_repo: "zread(repo='owner/repo') → kb_ingest_url()",
      js_rendered_page: "agent-browser / xbrowser scrape(url) → kb_ingest_url()",
      local_project: "kb_ingest_repo(repo_url) → 自动克隆分析存储",
    },
    hint: miss.recurring
      ? `⚠️ 已 miss ${miss.total_misses} 次（${loopsUsed}轮回流后仍未找到）。建议联网搜索。`
      : `知识库未命中（已尝试${loopsUsed}轮意图重写）。请联网搜索后存储。`,
  }
}

export async function kbAskPipeline(
  query: string,
  maxWebResults: number = 3,
  onStatus?: (status: string) => void,
): Promise<AskResult> {
  const llm = resolvePiConfig()
  const allQueriesUsed: string[] = [query]
  const { maxLoops, highScoreThreshold, lowScoreThreshold } = getAskPipelineConfig()

  if (!llm) {
    const result = fallbackSearch(query, allQueriesUsed)
    result.degraded = true
    return result
  }

  onStatus?.("分析查询意图...")
  const intent = await analyzeIntent(query, llm)
  const intentDegraded = !!(intent as IntentAnalysis & { degraded?: boolean }).degraded
  if (intent.rewrittenQuery && intent.rewrittenQuery !== query) {
    allQueriesUsed.push(intent.rewrittenQuery)
  }
  for (const sq of intent.subQueries.slice(0, 3)) {
    if (sq !== query && !allQueriesUsed.includes(sq)) {
      allQueriesUsed.push(sq)
    }
  }

  const seenDocIds = new Set<string>()

  for (let loop = 0; loop <= maxLoops; loop++) {
    const searchQueries = loop === 0
      ? [query, intent.rewrittenQuery, ...intent.subQueries.slice(0, 3)]
      : [intent.rewrittenQuery, ...intent.missingAspects.map((a: string) => `${query} ${a}`)]

    const allQueries = [...new Set(searchQueries.filter(Boolean))]
    if (loop > 0) {
      for (const q of allQueries) {
        if (!allQueriesUsed.includes(q)) allQueriesUsed.push(q)
      }
    }

    onStatus?.(loop === 0 ? "搜索知识库..." : `第${loop + 1}轮搜索...`)
    const results = await multiSearch(allQueries, 5)

    if (results.length === 0) {
      if (loop >= maxLoops) break
      continue
    }

    const best = results[0]

    if (best.score >= highScoreThreshold) {
      const full = _deps.readDoc(best.id, false)
      const content = full ? full.content : ""

      const canAutoComplete = best.score >= AUTO_COMPLETE_THRESHOLD && content.length >= MIN_CONTENT_LENGTH
      if (canAutoComplete) {
        const baseResult: AskResult = {
          from_kb: true,
          id: best.id,
          title: best.title,
          score: best.score,
          content: content.slice(0, 4000),
          quality: "high",
          completeness: "complete",
          loops_used: loop,
          queries_used: allQueriesUsed,
          hint: `Auto-complete: high score skip LLM evaluation (score=${best.score}, content=${content.length}c, loop=${loop})`,
        }
        return baseResult
      }

      try {
        onStatus?.("评估结果质量...")
        const evaluation = await evaluateQuality(query, intent, best, content, results, llm)

        let calibratedCompleteness = evaluation.completeness
        const contentLen = content.length
        if (contentLen < MIN_CONTENT_LENGTH && evaluation.completeness === "complete") {
          calibratedCompleteness = "partial"
        } else if (contentLen < MIN_SHORT_CONTENT_LENGTH && evaluation.completeness === "partial") {
          calibratedCompleteness = "incomplete"
        }

        const hasCodeBlock = /```[\s\S]*?```/.test(content)
        const userWantsUsage = /用法|example|how.to|usage|api|tool|function|method|class|component|用|使/.test(query)
        if (!hasCodeBlock && userWantsUsage && calibratedCompleteness === "complete") {
          calibratedCompleteness = "partial"
        }

        const baseResult: AskResult = {
          from_kb: true,
          id: best.id,
          title: best.title,
          score: best.score,
          content: content.slice(0, 4000),
          quality: evaluation.relevanceScore >= HIGH_RELEVANCE_SCORE ? "high" : "medium",
          completeness: calibratedCompleteness,
          loops_used: loop,
          queries_used: allQueriesUsed,
          hint: `KB match (score=${best.score}, relevance=${evaluation.relevanceScore}, completeness=${calibratedCompleteness}${calibratedCompleteness !== evaluation.completeness ? ` [calibrated from ${evaluation.completeness}, content=${contentLen}c]` : ""}, loop=${loop})`,
        }

        if (calibratedCompleteness === "incomplete") {
          const augQuery = evaluation.webSearchQuery || intent.rewrittenQuery || query
          return await augmentWithWebSearch(baseResult, augQuery, maxWebResults)
        }

        if (calibratedCompleteness === "partial") {
          const researchQuery = evaluation.webSearchQuery || intent.rewrittenQuery || query
          const research = await autoResearch(researchQuery, allQueriesUsed)
          if (research) return research
        }

        if (evaluation.webSearchRecommended && evaluation.webSearchQuery) {
          baseResult.web_search_suggestion = buildWebSearchSuggestion(
            evaluation.completeness === "incomplete"
              ? `KB 结果不完整，缺少: ${evaluation.missingAspects.join(", ")}`
              : evaluation.completeness === "partial"
                ? `KB 有部分结果，但可能存在更多选择（缺少: ${evaluation.missingAspects.join(", ") || "更全面的工具/方案对比"}）`
                : "用户意图涉及探索性查询，建议联网查找更多可能",
            evaluation.webSearchQuery,
            evaluation.missingAspects,
          )
          baseResult.hint += ` | 🌐 建议联网搜索: "${evaluation.webSearchQuery}"`
        }

        return baseResult
      } catch {
        const baseResult: AskResult = {
          from_kb: true,
          id: best.id,
          title: best.title,
          score: best.score,
          content: content.slice(0, 4000),
          quality: "high",
          completeness: "partial",
          degraded: true,
          loops_used: loop,
          queries_used: allQueriesUsed,
          hint: `High confidence match (score=${best.score}, loop=${loop}, evaluation failed)`,
        }

        baseResult.web_search_suggestion = buildWebSearchSuggestion(
          "评估失败，建议联网确认是否有更多资源",
          intent.rewrittenQuery,
          [],
        )

        return baseResult
      }
    }

    if (best.score >= lowScoreThreshold) {
      if (seenDocIds.has(best.id) && loop > 0) {
        const full = _deps.readDoc(best.id, false)
        const content = full ? full.content : ""

        const partialResult: AskResult = {
          from_kb: true,
          id: best.id,
          title: best.title,
          score: best.score,
          content: content.slice(0, 4000),
          quality: "medium",
          completeness: "partial",
          loops_used: loop,
          queries_used: allQueriesUsed,
          web_search_suggestion: buildWebSearchSuggestion(
            "回流后仍为同一结果，KB 覆盖有限，建议联网补充",
            intent.rewrittenQuery,
            intent.missingAspects,
          ),
          hint: `Best available match after ${loop} loops (score=${best.score}) | 🌐 建议联网搜索补充`,
        }
        return await augmentWithWebSearch(partialResult, intent.rewrittenQuery, maxWebResults)
      }

      seenDocIds.add(best.id)

      const full = _deps.readDoc(best.id, false)
      const content = full ? full.content : ""

      try {
        onStatus?.("评估结果质量...")
        const evaluation = await evaluateQuality(query, intent, best, content, results, llm)

        if (evaluation.isRelevant) {
          const baseResult: AskResult = {
            from_kb: true,
            id: best.id,
            title: best.title,
            score: best.score,
            content: content.slice(0, 4000),
            quality: evaluation.relevanceScore >= HIGH_RELEVANCE_SCORE ? "high" : "medium",
            completeness: evaluation.completeness,
            loops_used: loop,
            queries_used: allQueriesUsed,
            hint: `Match after evaluation (relevance=${evaluation.relevanceScore}, score=${best.score}, loop=${loop})`,
          }

          if (evaluation.webSearchRecommended && evaluation.webSearchQuery) {
            baseResult.web_search_suggestion = buildWebSearchSuggestion(
              evaluation.completeness === "incomplete"
                ? `KB 结果不完整，缺少: ${evaluation.missingAspects.join(", ")}`
                : "KB 有部分结果，但建议联网查找更多可能性",
              evaluation.webSearchQuery,
              evaluation.missingAspects,
            )
            baseResult.hint += ` | 🌐 建议联网搜索: "${evaluation.webSearchQuery}"`
            if (evaluation.completeness === "incomplete" || (evaluation.completeness === "partial" && evaluation.relevanceScore < LOW_RELEVANCE_SCORE)) {
              return await augmentWithWebSearch(baseResult, evaluation.webSearchQuery, maxWebResults)
            }
          }

          return baseResult
        }

        if (loop >= maxLoops) {
          const lowResult: AskResult = {
            from_kb: true,
            id: best.id,
            title: best.title,
            score: best.score,
            content: content.slice(0, 4000),
            quality: "low",
            completeness: "incomplete",
            loops_used: loop,
            queries_used: allQueriesUsed,
            web_search_suggestion: buildWebSearchSuggestion(
              `相关性低(relevance=${evaluation.relevanceScore})，强烈建议联网搜索更合适的资源`,
              evaluation.webSearchQuery || intent.rewrittenQuery,
              evaluation.missingAspects,
            ),
            hint: `Low relevance (relevance=${evaluation.relevanceScore}) | 🌐 强烈建议联网搜索`,
          }
          return await augmentWithWebSearch(lowResult, evaluation.webSearchQuery || intent.rewrittenQuery, maxWebResults)
        }

        if (evaluation.suggestedRewrite) {
          intent.rewrittenQuery = evaluation.suggestedRewrite
          intent.missingAspects = evaluation.missingAspects
          continue
        }
      } catch {
        return {
          from_kb: true,
          id: best.id,
          title: best.title,
          score: best.score,
          content: content.slice(0, 4000),
          quality: "medium",
          completeness: "partial",
          degraded: true,
          loops_used: loop,
          queries_used: allQueriesUsed,
          web_search_suggestion: buildWebSearchSuggestion(
            "评估失败，建议联网查找更多资源",
            intent.rewrittenQuery,
            [],
          ),
          hint: `Match (score=${best.score}, evaluation failed, loop=${loop}) | 🌐 建议联网搜索`,
        }
      }

      continue
    }

    if (loop >= maxLoops) break
  }

  if (maxWebResults > 0) {
    try {
      onStatus?.("联网搜索补充...")
      const webResults = await searchViaPipeline(
        intent?.rewrittenQuery || query,
        maxWebResults,
      )

      if (webResults.length > 0) {
        const webContent = webResults.map(r => `## ${r.title}\n${r.snippet}\nSource: ${r.url}`).join("\n\n")
        const webResultRefs = webResults.map(r => ({ id: "", title: r.title, url: r.url, source: r.source }))

        _deps.resolveMiss(query)

        return {
          from_kb: false,
          web_results: webResultRefs,
          content: webContent,
          loops_used: maxLoops,
          queries_used: allQueriesUsed,
          hint: `知识库未命中，已联网搜索到 ${webResults.length} 条摘要（深度研究会自动存储完整内容）`,
        }
      }
    } catch {
    }

    onStatus?.("数据源发现与抓取...")
    const discoveryResult = await autoSourceDiscovery(query, allQueriesUsed, onStatus)
    if (discoveryResult) return discoveryResult

    onStatus?.("自动深度研究...")
    const researchResult = await autoResearch(query, allQueriesUsed)
    if (researchResult) return researchResult
  }

  return buildMissResponse(query, allQueriesUsed, maxLoops)
}

async function autoSourceDiscovery(
  query: string,
  allQueriesUsed: string[],
  onStatus?: (status: string) => void,
): Promise<AskResult | null> {
  const config = loadConfig()
  if (!config.searchPipeline?.enabled) return null

  const isDataQuery = /名单|名录|大全|列表|所有|全部|完整|目录|directory|list|all|complete/i.test(query)
  if (!isDataQuery) return null

  try {
    const { discoverAndIngest } = await import("./source-discovery.js")
    const discovery = await discoverAndIngest(query, {
      maxSearchResults: 10,
      maxDeepReads: 3,
      autoSave: true,
      onStatus,
    })

    if (discovery.docs_saved.length === 0) return null

    const bestDoc = discovery.docs_saved[0]
    const full = _deps.readDoc(bestDoc.id, false)
    const content = full ? full.content : ""

    const sources = discovery.discovered_sources
      .slice(0, 5)
      .map(s => `- [${s.title}](${s.url}) (权威度: ${s.authority_score})`)
      .join("\n")

    return {
      from_kb: true,
      id: bestDoc.id,
      title: bestDoc.title,
      score: 40,
      content: content.slice(0, 8000),
      quality: "medium",
      completeness: discovery.pages_success >= 2 ? "complete" : "partial",
      loops_used: getAskPipelineConfig().maxLoops,
      queries_used: allQueriesUsed,
      auto_saved: true,
      hint: `🔍 数据源发现: 找到 ${discovery.discovered_sources.length} 个数据源，抓取 ${discovery.pages_success}/${discovery.pages_read} 页，入库 ${discovery.docs_saved.length} 篇`,
    }
  } catch (e) {
    logger.debug(`autoSourceDiscovery failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

async function autoResearch(query: string, allQueriesUsed: string[]): Promise<AskResult | null> {
  const config = loadConfig()
  if (!config.searchPipeline?.enabled) return null

  try {
    const { ResearchAgent } = await import("../research/research-agent.js")
    const agent = new ResearchAgent(
      { query, mode: "standard" },
      () => {},
    )
    const result = await agent.run()

    if (!result.summary || result.summary.length < MIN_SUMMARY_LENGTH) return null

    const dr = result.deepReadResults || []
    const drSuccess = dr.filter(r => r.success).length
    const sources = (result.sources || []).map(s => `- [${s.title}](${s.url})`).slice(0, 10).join("\n")

    const searchTitleWords = (result.searchResults || [])
      .flatMap(r => r.title.split(/[\s|\-–—:：,，.·/\\()（）\[\]]+/))
      .filter(w => w.length > 2 && w.length < 30)
      .map(w => w.toLowerCase())
    const queryWords = query.split(/[\s,，]+/).filter(w => w.length > 1)
    const keywordCounts = new Map<string, number>()
    for (const w of [...searchTitleWords, ...queryWords]) {
      keywordCounts.set(w, (keywordCounts.get(w) || 0) + 1)
    }
    const keywords = [...keywordCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([w]) => w)

    const doc = _deps.writeDoc(
      {
        title: `研究: ${query}`,
        tags: ["reference", "web-ingested", "auto-research"],
        keywords,
        intent: `kb_ask auto-research for: ${query}`,
        project_description: "kb_ask deep research",
        source_project: "",
        source_worktree: "",
        project_path: "",
        related_projects: [],
        related_files: [],
      },
      result.summary + (sources ? `\n\n## 参考资料\n${sources}` : ""),
    )

    _deps.resolveMiss(query)

    return {
      from_kb: true,
      id: doc.id,
      title: doc.title,
      score: 50,
      content: result.summary.slice(0, 8000),
      quality: result.finalQualityScore >= MIN_RESULTS_FOR_COMPLETE ? "high" : "medium",
      completeness: result.finalCoverageScore >= MIN_RESULTS_FOR_COMPLETE ? "complete" : "partial",
      loops_used: getAskPipelineConfig().maxLoops,
      queries_used: allQueriesUsed,
      auto_saved: true,
      hint: `🔍 自动深度研究完成 (Q=${result.finalQualityScore}/10, C=${result.finalCoverageScore}/10, 深读=${drSuccess}/${dr.length}, ${(result.durationMs / 1000).toFixed(0)}s)`,
    }
  } catch {
    return null
  }
}

function fallbackSearch(
  query: string,
  queriesUsed: string[],
): AskResult {
  const { highScoreThreshold, lowScoreThreshold } = getAskPipelineConfig()
  const results = _deps.searchDocs(query, undefined, undefined, 3)
  const highScoreHits = results.filter(r => r.score >= lowScoreThreshold)

  if (highScoreHits.length > 0) {
    const best = highScoreHits[0]
    const full = _deps.readDoc(best.id, false)
    return {
      from_kb: true,
      id: best.id,
      title: best.title,
      score: best.score,
      content: full ? full.content.slice(0, 4000) : best.snippet || best.intent,
      quality: best.score >= highScoreThreshold ? "high" : "medium",
      completeness: "partial",
      loops_used: 0,
      queries_used: queriesUsed,
      web_search_suggestion: buildWebSearchSuggestion(
        "无 LLM 可用，无法评估完整度，建议联网确认是否有更多资源",
        query,
        [],
      ),
      hint: "Direct match (no LLM) | 🌐 建议联网确认",
    }
  }

  _deps.recordMiss(query)

  return {
    from_kb: false,
    queries_used: queriesUsed,
    hint: "No match (no LLM available for query rewriting)",
  }
}
