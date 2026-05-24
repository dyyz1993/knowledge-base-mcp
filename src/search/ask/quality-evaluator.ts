import { callLlm, type LlmConfig } from "../llm-caller"
import type { DocMeta } from "../../storage/index"
import { llmStats } from "../../statistics"
import { loadConfig } from "../../config"
import type { IntentAnalysis } from "./intent-analyzer"

export interface QualityEvaluation {
  relevanceScore: number
  isRelevant: boolean
  completeness: "complete" | "partial" | "incomplete"
  missingAspects: string[]
  suggestedRewrite: string | null
  webSearchRecommended: boolean
  webSearchQuery: string | null
}

export async function evaluateQuality(
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
      isRelevant: docMeta.score >= loadConfig().askPipeline.highScoreThreshold,
      completeness: docMeta.score >= loadConfig().askPipeline.highScoreThreshold ? "partial" : "incomplete",
      missingAspects: [],
      suggestedRewrite: null,
      webSearchRecommended: true,
      webSearchQuery: intent.rewrittenQuery,
    }
  }
}
