import type { AnalyzeQueryResult } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"
import { createLogger } from "../../utils/logger.js"
import { extractJsonObject } from "../utils/json-parser.js"


const logger = createLogger("research:steps:analyze-query")
const SYSTEM_PROMPT =
  "You are a search query optimizer. You analyze user queries and generate diverse search keywords. You MUST respond with ONLY valid JSON. No markdown. No explanation. No code fences. Just the JSON object."

function buildUserPrompt(query: string, warningPrompt?: string): string {
  const warningSection = warningPrompt ? `\nContext: ${warningPrompt}\n` : ""
  return `Analyze this research query: "${query}"
${warningSection}
CRITICAL: Return ONLY raw JSON. No markdown fences. No extra text.

Required format:
{"coreKeywords":["keyword1","keyword2"],"subQueries":["query 1","query 2","query 3","query 4","query 5","query 6","query 7"],"researchType":"doc","language":"zh"}

Rules:
- coreKeywords: 3-7 extracted technical terms. REMOVE filler words: 什么是 如何 怎么 为什么 介绍一下 请问 的 了 吗 呢 完整 列表 从零 搭建 应用 深度 分析
- subQueries: EXACTLY 7 diverse search queries as a flat array. Distribution:
  * 2 in the ORIGINAL language (Chinese if query is Chinese)
  * 2 in ENGLISH (use key technical terms)
  * 2 targeting specific SUB-TOPICS or features (break down the query)
  * 1 broad OVERVIEW query
  NEVER repeat the original query. Each subQuery MUST be meaningfully different.
  CRITICAL: Every subQuery MUST preserve ALL core concepts from the original query. Do NOT drop any important keyword. E.g. "Docker sandbox" → subQueries must include BOTH "docker" AND "sandbox" concepts.
  IMPORTANT: Each subQuery must be SHORT (3-6 words max). Avoid long compound queries — they return 0 results from search engines. Break complex queries into focused short phrases.
  GOOD: "free backlink submission sites 2025" or "tech startup directory dofollow"
  BAD: "complete list of all websites where tech startups can submit SEO backlinks with DA scores"
- researchType: one of doc|api|code|concept|comparison
- language: zh|en|mixed

Think step by step about what aspects of "${query}" a researcher would want to learn about, then generate diverse queries covering those aspects.`
}

function buildFallback(query: string): AnalyzeQueryResult {
  const hasChinese = /[\u4e00-\u9fff]/.test(query)
  const keywords = extractKeywords(query)
  return {
    coreKeywords: keywords.slice(0, 5),
    subQueries: generateFallbackQueries(query),
    researchType: "concept",
    language: hasChinese ? "zh" : "en",
  }
}

/**
 * 从查询中提取有意义的关键词（去除中文虚词和短词）
 */
function extractKeywords(query: string): string[] {
  const cleaned = query
    .replace(/[什么是如何怎么为什么介绍一下请问的了呢吗完整列表、，。！？\s]+/g, " ")
    .trim()
  const words = cleaned.split(/\s+/).filter(w => w.length > 1)
  // 如果提取后为空，回退到原始查询
  return words.length > 0 ? words : [query]
}

function parseResponse(raw: string, query: string): AnalyzeQueryResult {
  const jsonStr = extractJsonObject(raw)
  if (!jsonStr) {
    logger.warn("Failed to extract JSON from LLM response, using fallback")
    return buildFallback(query)
  }
  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>
    const coreKeywords = Array.isArray(parsed.coreKeywords)
      ? parsed.coreKeywords as string[]
      : [query]

    let subQueries: string[] = []
    if (Array.isArray(parsed.subQueries)) {
      subQueries = parsed.subQueries as string[]
    } else if (parsed.subQueries && typeof parsed.subQueries === "object") {
      const sq = parsed.subQueries as Record<string, string[]>
      const zh = Array.isArray(sq.zh) ? sq.zh : []
      const en = Array.isArray(sq.en) ? sq.en : []
      subQueries = [...zh, ...en]
    }

    // 如果 subQueries 为空，或者只有 1 个且和原查询几乎一样 → 补充
    if (subQueries.length === 0) {
      subQueries = []
    }
    if (subQueries.length === 1 && similarityRatio(subQueries[0], query) > 0.7) {
      // LLM 只是把原查询回吐了，不算是有效的 subQuery
      subQueries = []
    }

    // 如果有效 subQueries 不足 5 个，用 fallback 补充
    if (subQueries.length < 5) {
      const extras = generateFallbackQueries(query)
      for (const e of extras) {
        if (!subQueries.includes(e) && subQueries.length < 8) subQueries.push(e)
      }
    }

    // 如果 coreKeywords 只有 1 个且等于原查询，也重新提取
    if (coreKeywords.length === 1 && coreKeywords[0] === query) {
      coreKeywords.splice(0, 1, ...extractKeywords(query))
    }

    const researchType = parsed.researchType as string | undefined
    const validTypes = ["doc", "api", "code", "concept", "comparison"]
    const language = parsed.language as string | undefined
    const validLangs = ["zh", "en", "mixed"]

    return {
      coreKeywords,
      subQueries: subQueries.slice(0, 10),
      researchType: validTypes.includes(researchType || "") ? researchType as AnalyzeQueryResult["researchType"] : "concept",
      language: validLangs.includes(language || "") ? language as AnalyzeQueryResult["language"] : (/[\u4e00-\u9fff]/.test(query) ? "zh" : "en"),
    }
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
  return buildFallback(query)
}

export async function analyzeQuery(
  query: string,
  smallModel: LlmConfig,
  warningPrompt?: string,
): Promise<AnalyzeQueryResult> {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(query, warningPrompt) },
  ]

  const raw = await callLlm(smallModel, messages, 0.3, 1200, 60_000)
  if (!raw) return buildFallback(query)

  return parseResponse(raw, query)
}

function generateFallbackQueries(query: string): string[] {
  const queries: string[] = []
  const hasChinese = /[\u4e00-\u9fff]/.test(query)
  const keywords = extractKeywords(query)
  const joined = keywords.join(" ")

  // 中文视角（如果原查询有中文）
  if (hasChinese) {
    queries.push(`${joined} 教程 入门`)
    queries.push(`${joined} 最佳实践 经验总结`)
    queries.push(`${joined} 原理 深度解析`)
    queries.push(`${joined} 常见问题 解决方案`)
  }

  // 英文视角 — 拆分技术关键词
  const enTerms = keywords.filter(w => !/[\u4e00-\u9fff]/.test(w)).join(" ") || joined
  queries.push(`${enTerms} tutorial getting started`)
  queries.push(`${enTerms} best practices guide`)
  queries.push(`${enTerms} examples code usage`)
  queries.push(`${enTerms} vs alternatives comparison`)

  // 去重并截取
  const unique = [...new Set(queries)]
  return unique.slice(0, 8)
}

/**
 * 计算两个字符串的简单相似度（共同字符占比）
 */
function similarityRatio(a: string, b: string): number {
  if (a === b) return 1
  const setA = new Set(a.toLowerCase())
  const setB = new Set(b.toLowerCase())
  if (setA.size === 0 && setB.size === 0) return 0
  let intersection = 0
  for (const c of setA) { if (setB.has(c)) intersection++ }
  return intersection / (setA.size + setB.size - intersection)
}
