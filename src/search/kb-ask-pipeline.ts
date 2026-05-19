import { searchDocs, readDoc, writeDoc, resolveMiss, recordMiss } from "../storage/index"
import type { DocMeta } from "../storage/index"
import { callLlm, type LlmConfig } from "./llm-caller"
import { getConfiguredModels } from "../chat/api-models"
import { loadConfig } from "../config"
import type { SearchSource, SearchResult } from "./types"
import { llmStats } from "../statistics"
import { WebSearchPrimeSource } from "./source-web-search-prime"
import { TavilySource } from "./source-tavily"
import { SerperSource } from "./source-serper"
import { createXBrowserSources } from "./source-xbrowser"
import { AiSearchSource } from "./source-ai-search"
import { SearchPipeline } from "./search-pipeline"

const MAX_LOOPS = 2
const HIGH_SCORE_THRESHOLD = 45
const LOW_SCORE_THRESHOLD = 20

interface AskResult {
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

interface IntentAnalysis {
  coreKeywords: string[]
  subQueries: string[]
  researchType: string
  rewrittenQuery: string
  missingAspects: string[]
}

interface QualityEvaluation {
  relevanceScore: number
  isRelevant: boolean
  completeness: "complete" | "partial" | "incomplete"
  missingAspects: string[]
  suggestedRewrite: string | null
  webSearchRecommended: boolean
  webSearchQuery: string | null
}

function resolvePiConfig(): LlmConfig | null {
  const configured = getConfiguredModels()
  const usable = configured.filter(m => m.apiKey && m.baseUrl)
  if (usable.length === 0) return null

  const priorityPatterns = [
    /glm-4\.5/i, /glm-5/i, /gpt-4/i, /claude/i, /deepseek/i,
    /mini/i, /flash/i, /air/i, /lite/i,
  ]

  for (const pattern of priorityPatterns) {
    const found = usable.find(m => pattern.test(m.id))
    if (found) {
      return { baseUrl: found.baseUrl!, apiKey: found.apiKey!, model: found.id }
    }
  }

  const first = usable[0]
  return { baseUrl: first.baseUrl!, apiKey: first.apiKey!, model: first.id }
}

async function analyzeIntent(query: string, llm: LlmConfig): Promise<IntentAnalysis> {
  const messages = [
    {
      role: "system" as const,
      content: "You are a search query optimizer for a knowledge base. Analyze the user's natural language query and extract intent. Always respond with valid JSON only.",
    },
    {
      role: "user" as const,
      content: `Analyze this query: "${query}"

Return JSON ONLY (no markdown fences):
{"coreKeywords":["keyword1","keyword2"],"subQueries":["query1","query2","query3"],"researchType":"doc|api|code|concept|comparison","rewrittenQuery":"optimized search query"}

Rules:
- coreKeywords: 3-7 essential terms, remove filler words (什么是 如何 怎么 为什么 我想 请帮我 的 了 吗 呢)
- subQueries: 3-5 search queries, include:
  1. English keyword-only query (e.g. "iOS debugger MCP")
  2. Chinese keyword query
  3. Technical variation with different synonyms
  Keep subQueries SHORT (2-5 words), keyword-focused, no full sentences
- researchType: categorize the intent
- rewrittenQuery: the best short keyword-only query combining core keywords`,
    },
  ]

  try {
    const t0 = Date.now()
    const raw = await callLlm(llm, messages, 0.1, 600)
    const ms = Date.now() - t0
    llmStats.recordCall(llm.model, 600, ms)
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
    const parsed = JSON.parse(cleaned)

    return {
      coreKeywords: Array.isArray(parsed.coreKeywords) ? parsed.coreKeywords.slice(0, 7) : [],
      subQueries: Array.isArray(parsed.subQueries) ? parsed.subQueries.slice(0, 5) : [],
      researchType: parsed.researchType || "concept",
      rewrittenQuery: parsed.rewrittenQuery || query,
      missingAspects: [],
    }
  } catch {
    return {
      coreKeywords: query.split(/[\s,，]+/).filter(w => w.length > 1).slice(0, 5),
      subQueries: [query],
      researchType: "concept",
      rewrittenQuery: query,
      missingAspects: [],
    }
  }
}

async function evaluateQuality(
  query: string,
  intent: IntentAnalysis,
  docMeta: DocMeta & { score: number },
  content: string,
  allResults: (DocMeta & { score: number })[],
  llm: LlmConfig,
): Promise<QualityEvaluation> {
  const otherTitles = allResults
    .filter(r => r.id !== docMeta.id)
    .slice(0, 4)
    .map(r => r.title)
    .join(", ")

  const messages = [
    {
      role: "system" as const,
      content: "You are a knowledge base completeness evaluator. Judge if existing documents FULLY cover the user's intent, or if web search is needed to find more resources. Always respond with valid JSON only.",
    },
    {
      role: "user" as const,
      content: `User query: "${query}"
Extracted intent: type=${intent.researchType}, keywords=[${intent.coreKeywords.join(", ")}]

Best matching document:
- Title: "${docMeta.title}"
- Tags: [${docMeta.tags.join(", ")}]
- Description: "${docMeta.intent}"
- Content preview: ${content.slice(0, 600)}

Other KB results: ${otherTitles || "none"}

Evaluate BOTH relevance AND completeness. Return JSON ONLY:
{"relevanceScore":85,"isRelevant":true,"completeness":"complete|partial|incomplete","missingAspects":[],"suggestedRewrite":null,"webSearchRecommended":false,"webSearchQuery":null}

Rules:
- relevanceScore: 0-100 based on how well the document CONTENT (not just title) matches the query
- isRelevant: true if this document directly addresses the query with substantive content
- completeness:
  - "complete": Document contains enough detail to fully answer the user's question — includes concrete examples, API references, code snippets, or step-by-step instructions. NOT just links, references, or pointers to other resources.
  - "partial": Document is on-topic but lacks depth — only high-level overview, missing code examples, or only covers part of the topic. Also use for documents that mainly reference/point to other sources instead of providing answers directly.
  - "incomplete": Document barely touches the topic or is tangentially related. Also use for documents that are just index pages, navigation guides, or "see also" references.
- missingAspects: only list aspects that are genuinely important and missing (can be empty [])
- webSearchRecommended: true ONLY when completeness is "incomplete", or "partial" AND missing aspects are critical. Default to false.
- webSearchQuery: if webSearchRecommended=true, provide search query; otherwise null

IMPORTANT: Evaluate based on SUBSTANCE, not just topic match. A document titled "AI SDK" that only says "read the docs at ai-sdk.dev" is NOT "complete" — it's "incomplete". A document needs actual explanatory content, code examples, or detailed instructions to qualify as "complete".`,
    },
  ]

  try {
    const t0 = Date.now()
    const raw = await callLlm(llm, messages, 0.2, 2000)
    const ms = Date.now() - t0
    llmStats.recordCall(llm.model, 2000, ms)
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
    const parsed = JSON.parse(cleaned)

    return {
      relevanceScore: typeof parsed.relevanceScore === "number" ? parsed.relevanceScore : 0,
      isRelevant: parsed.isRelevant === true,
      completeness: ["complete", "partial", "incomplete"].includes(parsed.completeness)
        ? parsed.completeness
        : "partial",
      missingAspects: Array.isArray(parsed.missingAspects) ? parsed.missingAspects : [],
      suggestedRewrite: typeof parsed.suggestedRewrite === "string" && parsed.suggestedRewrite.length > 0
        ? parsed.suggestedRewrite
        : null,
      webSearchRecommended: parsed.webSearchRecommended === true,
      webSearchQuery: typeof parsed.webSearchQuery === "string" && parsed.webSearchQuery.length > 0
        ? parsed.webSearchQuery
        : null,
    }
  } catch {
    return {
      relevanceScore: docMeta.score,
      isRelevant: docMeta.score >= HIGH_SCORE_THRESHOLD,
      completeness: docMeta.score >= HIGH_SCORE_THRESHOLD ? "partial" : "incomplete",
      missingAspects: [],
      suggestedRewrite: null,
      webSearchRecommended: true,
      webSearchQuery: intent.rewrittenQuery,
    }
  }
}

function multiSearch(queries: string[], limit = 5): (DocMeta & { score: number; snippet?: string; matched_by: string[] })[] {
  const seen = new Map<string, DocMeta & { score: number; snippet?: string; matched_by: string[] }>()

  for (const q of queries) {
    const results = searchDocs(q, undefined, undefined, limit)
    for (const r of results) {
      const existing = seen.get(r.id)
      if (existing) {
        existing.score += r.score
      } else {
        seen.set(r.id, { ...r })
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.score - a.score)
}

function buildWebSearchSuggestion(
  reason: string,
  searchQuery: string,
  missingAspects: string[],
): AskResult["web_search_suggestion"] {
  return { reason, search_query: searchQuery, missing_aspects: missingAspects }
}

function buildSearchPipelineSources(): SearchSource[] {
  const config = loadConfig()
  const sources: SearchSource[] = []

  if (config.searchPipeline?.sources.webSearchPrime.enabled && config.webSearch.apiKey) {
    sources.push(new WebSearchPrimeSource())
  }
  if (config.webSearch.tavilyApiKey && config.searchPipeline?.sources.tavily?.enabled) {
    sources.push(new TavilySource())
  }
  if (config.webSearch.serperApiKey && config.searchPipeline?.sources.serper?.enabled) {
    sources.push(new SerperSource())
  }
  if (config.searchPipeline?.sources.xbrowser.enabled) {
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
  if (config.searchPipeline?.sources.aiSearch?.enabled) {
    sources.push(new AiSearchSource())
  }

  return sources
}

async function searchViaPipeline(query: string, maxResults: number): Promise<SearchResult[]> {
  const sources = buildSearchPipelineSources()
  if (sources.length === 0) return []

  const pipeline = new SearchPipeline(sources)
  const result = await pipeline.search(query, maxResults)
  return result.results
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

      // If completeness is not "complete", trigger deep research for a thorough answer
      // (snippets alone are rarely sufficient; research does actual deep reading)
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
    // web search augmentation failed — keep original result
  }
  return baseResult
}

function buildMissResponse(query: string, allQueriesUsed: string[], loopsUsed: number): AskResult {
  const miss = recordMiss(query)

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
): Promise<AskResult> {
  const llm = resolvePiConfig()
  const allQueriesUsed: string[] = [query]

  if (!llm) {
    return fallbackSearch(query, allQueriesUsed)
  }

  const intent = await analyzeIntent(query, llm)
  if (intent.rewrittenQuery && intent.rewrittenQuery !== query) {
    allQueriesUsed.push(intent.rewrittenQuery)
  }
  for (const sq of intent.subQueries.slice(0, 3)) {
    if (sq !== query && !allQueriesUsed.includes(sq)) {
      allQueriesUsed.push(sq)
    }
  }

  const seenDocIds = new Set<string>()

  for (let loop = 0; loop <= MAX_LOOPS; loop++) {
    const searchQueries = loop === 0
      ? [query, intent.rewrittenQuery, ...intent.subQueries.slice(0, 3)]
      : [intent.rewrittenQuery, ...intent.missingAspects.map((a: string) => `${query} ${a}`)]

    const allQueries = [...new Set(searchQueries.filter(Boolean))]
    if (loop > 0) {
      for (const q of allQueries) {
        if (!allQueriesUsed.includes(q)) allQueriesUsed.push(q)
      }
    }

    const results = multiSearch(allQueries, 5)

    if (results.length === 0) {
      if (loop >= MAX_LOOPS) break
      continue
    }

    const best = results[0]

    if (best.score >= HIGH_SCORE_THRESHOLD) {
      const full = readDoc(best.id, false)
      const content = full ? full.content : ""

      try {
        const evaluation = await evaluateQuality(query, intent, best, content, results, llm)

        // Content substance calibration: detect code-less docs for API/tool queries
        let calibratedCompleteness = evaluation.completeness
        const contentLen = content.length
        if (contentLen < 300 && evaluation.completeness === "complete") {
          calibratedCompleteness = "partial"
        } else if (contentLen < 100 && evaluation.completeness === "partial") {
          calibratedCompleteness = "incomplete"
        }

        // If doc has no code blocks but user asks for usage/examples, downgrade
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
          quality: evaluation.relevanceScore >= 70 ? "high" : "medium",
          completeness: calibratedCompleteness,
          loops_used: loop,
          queries_used: allQueriesUsed,
          hint: `KB match (score=${best.score}, relevance=${evaluation.relevanceScore}, completeness=${calibratedCompleteness}${calibratedCompleteness !== evaluation.completeness ? ` [calibrated from ${evaluation.completeness}, content=${contentLen}c]` : ""}, loop=${loop})`,
        }

        // incomplete → quick web supplement, partial → deep research directly
        if (calibratedCompleteness === "incomplete") {
          const augQuery = evaluation.webSearchQuery || intent.rewrittenQuery || query
          return await augmentWithWebSearch(baseResult, augQuery, maxWebResults)
        }

        if (calibratedCompleteness === "partial") {
          const researchQuery = evaluation.webSearchQuery || intent.rewrittenQuery || query
          const research = await autoResearch(researchQuery, allQueriesUsed)
          if (research) return research
          // research failed, fall through to web search suggestion
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
          loops_used: loop,
          queries_used: allQueriesUsed,
          hint: `High confidence match (score=${best.score}, loop=${loop})`,
        }

        baseResult.web_search_suggestion = buildWebSearchSuggestion(
          "评估失败，建议联网确认是否有更多资源",
          intent.rewrittenQuery,
          [],
        )

        return baseResult
      }
    }

    if (best.score >= LOW_SCORE_THRESHOLD) {
      if (seenDocIds.has(best.id) && loop > 0) {
        const full = readDoc(best.id, false)
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

      const full = readDoc(best.id, false)
      const content = full ? full.content : ""

      try {
        const evaluation = await evaluateQuality(query, intent, best, content, results, llm)

        if (evaluation.isRelevant) {
          const baseResult: AskResult = {
            from_kb: true,
            id: best.id,
            title: best.title,
            score: best.score,
            content: content.slice(0, 4000),
            quality: evaluation.relevanceScore >= 70 ? "high" : "medium",
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
            if (evaluation.completeness === "incomplete" || (evaluation.completeness === "partial" && evaluation.relevanceScore < 60)) {
              return await augmentWithWebSearch(baseResult, evaluation.webSearchQuery, maxWebResults)
            }
          }

          return baseResult
        }

        if (loop >= MAX_LOOPS) {
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

    if (loop >= MAX_LOOPS) break
  }

  // KB miss — try web search before returning miss response
  try {
    const webResults = await searchViaPipeline(
      intent?.rewrittenQuery || query,
      maxWebResults,
    )

    if (webResults.length > 0) {
      const webContent = webResults.map(r => `## ${r.title}\n${r.snippet}\nSource: ${r.url}`).join("\n\n")
      const webResultRefs = webResults.map(r => ({ id: "", title: r.title, url: r.url, source: r.source }))

      resolveMiss(query)

      return {
        from_kb: false,
        web_results: webResultRefs,
        content: webContent,
        loops_used: MAX_LOOPS,
        queries_used: allQueriesUsed,
        hint: `知识库未命中，已联网搜索到 ${webResults.length} 条摘要（深度研究会自动存储完整内容）`,
      }
    }
  } catch {
    // web search failed — try auto research
  }

  const researchResult = await autoResearch(query, allQueriesUsed)
  if (researchResult) return researchResult

  return buildMissResponse(query, allQueriesUsed, MAX_LOOPS)
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

    if (!result.summary || result.summary.length < 200) return null

    const dr = result.deepReadResults || []
    const drSuccess = dr.filter(r => r.success).length
    const sources = (result.sources || []).map(s => `- [${s.title}](${s.url})`).slice(0, 10).join("\n")

    // Extract keywords from search result titles + query terms
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

    const doc = writeDoc(
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

    resolveMiss(query)

    return {
      from_kb: true,
      id: doc.id,
      title: doc.title,
      score: 50,
      content: result.summary.slice(0, 8000),
      quality: result.finalQualityScore >= 7 ? "high" : "medium",
      completeness: result.finalCoverageScore >= 7 ? "complete" : "partial",
      loops_used: MAX_LOOPS,
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
  const results = searchDocs(query, undefined, undefined, 3)
  const highScoreHits = results.filter(r => r.score >= LOW_SCORE_THRESHOLD)

  if (highScoreHits.length > 0) {
    const best = highScoreHits[0]
    const full = readDoc(best.id, false)
    return {
      from_kb: true,
      id: best.id,
      title: best.title,
      score: best.score,
      content: full ? full.content.slice(0, 4000) : best.snippet || best.intent,
      quality: best.score >= HIGH_SCORE_THRESHOLD ? "high" : "medium",
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

  return {
    from_kb: false,
    queries_used: queriesUsed,
    hint: "No match (no LLM available for query rewriting)",
  }
}
