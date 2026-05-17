import type { AnalyzeQueryResult } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"

const SYSTEM_PROMPT =
  "You are a search query optimizer. You analyze user queries and generate optimal search keywords. Always respond with valid JSON only."

function buildUserPrompt(query: string, warningPrompt?: string): string {
  const warningSection = warningPrompt ? `\nContext: ${warningPrompt}\n` : ""
  return `Analyze: "${query}"
${warningSection}
Return JSON ONLY (no markdown fences):
{"coreKeywords":["AI SDK","使用","generateText"],"subQueries":["AI SDK generateText 使用教程","AI SDK streamText 实时流式输出","Vercel AI SDK tool calling 配置","AI SDK structured output 示例","AI SDK tutorial getting started","AI SDK API reference documentation","How to use AI SDK for text generation"],"researchType":"doc","language":"zh"}

Rules:
- coreKeywords: 3-7 core technical terms extracted from query. Remove filler: 什么是 如何 怎么 为什么 介绍一下 请问 的 了 吗 呢 完整 列表
- subQueries: FLAT string array of exactly 7 diverse search queries. MUST include:
  * 2 queries in original language (Chinese if query is Chinese)
  * 2 queries in English (translated/technical terms)
  * 2 queries targeting specific sub-topics or features mentioned in query
  * 1 broad overview query
  Do NOT just repeat the original query. Each subQuery must be different.
- researchType: doc|api|code|concept|comparison
- language: zh|en|mixed`
}

function buildFallback(query: string): AnalyzeQueryResult {
  const hasChinese = /[\u4e00-\u9fff]/.test(query)
  return {
    coreKeywords: [query],
    subQueries: generateFallbackQueries(query).slice(0, 7),
    researchType: "concept",
    language: hasChinese ? "zh" : "en",
  }
}

function parseResponse(raw: string, query: string): AnalyzeQueryResult {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
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

    if (subQueries.length === 0) subQueries = [query]

    if (subQueries.length < 4) {
      const extras = generateFallbackQueries(query)
      for (const e of extras) {
        if (!subQueries.includes(e) && subQueries.length < 7) subQueries.push(e)
      }
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
  } catch {}
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

  const raw = await callLlm(smallModel, messages, 0.1, 800)
  if (!raw) return buildFallback(query)

  return parseResponse(raw, query)
}

function generateFallbackQueries(query: string): string[] {
  const queries: string[] = []
  const hasChinese = /[\u4e00-\u9fff]/.test(query)

  const keywords = query
    .replace(/[什么是如何怎么为什么介绍一下请问的了呢吗、，。！？\s]+/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 1)
    .slice(0, 5)

  if (hasChinese) {
    queries.push(keywords.join(" ") + " 教程")
    queries.push(keywords.join(" ") + " 最佳实践")
    queries.push(keywords.join(" ") + " 使用指南")
    queries.push(keywords.join(" ") + " 入门到精通")
  }

  const enTerms = keywords.join(" ")
  queries.push(`${enTerms} tutorial`)
  queries.push(`${enTerms} best practices guide`)
  queries.push(`${enTerms} getting started documentation`)
  queries.push(`${enTerms} examples and usage`)

  return queries
}
