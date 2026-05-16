import type { AnalyzeQueryResult } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"

const SYSTEM_PROMPT =
  "You are a search query optimizer. You analyze user queries and generate optimal search keywords. Always respond with valid JSON only."

function buildUserPrompt(query: string, warningPrompt?: string): string {
  const warningSection = warningPrompt ? `\nContext: ${warningPrompt}\n` : ""
  return `Analyze: "${query}"
${warningSection}
Return JSON ONLY (no markdown fences):
{"coreKeywords":["AI SDK","使用"],"subQueries":["AI SDK 使用教程","AI SDK tutorial","Vercel AI SDK 入门","Vercel AI SDK getting started","AI SDK API 参考"],"researchType":"doc","language":"zh"}

Rules:
- coreKeywords: 3-7 core terms. Remove: 什么是 如何 怎么 为什么 介绍一下 请问 的 了 吗 呢
- subQueries: FLAT string array of 5-8 search queries mixing original language and English
- researchType: doc|api|code|concept|comparison
- language: zh|en|mixed`
}

function buildFallback(query: string): AnalyzeQueryResult {
  const hasChinese = /[\u4e00-\u9fff]/.test(query)
  return {
    coreKeywords: [query],
    subQueries: [query],
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
