import { callLlm, type LlmConfig } from "../llm-caller"
import { getConfiguredModels } from "../../chat/api-models"
import { llmStats } from "../../statistics"

export interface IntentAnalysis {
  coreKeywords: string[]
  subQueries: string[]
  researchType: string
  rewrittenQuery: string
  missingAspects: string[]
  degraded?: boolean
}

export function resolvePiConfig(): LlmConfig | null {
  if (process.env.KB_NO_LLM) return null
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

export async function analyzeIntent(query: string, llm: LlmConfig): Promise<IntentAnalysis> {
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
  1. English keyword-only query preserving ALL concepts from original (e.g. "Docker sandbox isolation" not just "Docker")
  2. Chinese keyword query preserving ALL concepts
  3. Technical variation with different synonyms but keeping ALL concepts
  Keep subQueries SHORT (2-5 words), keyword-focused, no full sentences
  CRITICAL: Every subQuery MUST include ALL core concepts. Never drop keywords. "Docker sandbox" → subQueries must contain BOTH "docker" AND "sandbox", not just "docker".
- researchType: categorize the intent
- rewrittenQuery: the best short keyword-only query combining ALL core keywords, NEVER dropping any`,
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
      degraded: true,
    }
  }
}
