import type { EvaluateResult } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"
import type { SearchResult } from "../../search/types"

/** Extract JSON object from text that may contain extra content around it */
function extractJsonObject(text: string): string | null {
  if (!text || !text.trim()) return null
  // Try direct parse after stripping code fences
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch (e) {
    console.warn("[evaluate]", e instanceof Error ? e.message : String(e))
  }
  // Brace-matching fallback: find outermost valid JSON object
  let depth = 0
  let start = -1
  let lastValid: string | null = null
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i
      depth++
    } else if (cleaned[i] === "}") {
      depth--
      if (depth === 0 && start >= 0) {
        const candidate = cleaned.slice(start, i + 1)
        try {
          JSON.parse(candidate)
          lastValid = candidate
        } catch (e) {
          console.warn("[evaluate]", e instanceof Error ? e.message : String(e))
        }
      }
    }
  }
  return lastValid
}

/** Domains that are almost never relevant for technical research queries */
const LOW_QUALITY_DOMAINS = [
  "deployhq.com", "linkedin.com", "facebook.com", "twitter.com",
  "pinterest.com", "instagram.com", "tiktok.com",
]

/** Score a result's snippet relevance to the query by keyword overlap */
function snippetRelevance(query: string, result: SearchResult): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  const text = `${result.title} ${result.snippet}`.toLowerCase()
  let score = 0
  for (const term of queryTerms) {
    const count = (text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length
    score += count
  }
  // Boost by existing qualityScore
  score += (result.qualityScore || 0) * 0.5
  // Penalize known low-quality / irrelevant domains
  try {
    const host = new URL(result.url).hostname.toLowerCase()
    if (LOW_QUALITY_DOMAINS.some(d => host.endsWith(d))) score -= 30
  } catch {}
  return score
}

/** Simplified retry: ask LLM for just indices, then use snippetRelevance as final fallback */
async function retryEvaluateSimple(
  query: string,
  capped: SearchResult[],
  largeModel: LlmConfig,
): Promise<EvaluateResult> {
  const fallback: EvaluateResult = {
    selectedIndices: capped
      .map((r, i) => ({ i, score: snippetRelevance(query, r) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((r) => r.i),
    outline: "",
    sitemapHints: [],
    githubHints: [],
    initialAssessment: "",
  }

  try {
    console.warn("[evaluate] Retrying with simplified prompt...")
    const list = capped
      .map((r, i) => `[${i}] ${r.title} | ${r.snippet.slice(0, 150)}`)
      .join("\n")
    const retryPrompt = `Pick the 5 most relevant result indices for: "${query}"\n${list}\n\nReturn ONLY a JSON array of indices, e.g. [0, 3, 5, 7, 9]. No other text.`

    const retryRaw = await callLlm(
      largeModel,
      [
        { role: "system", content: "Return only a JSON array of integers. No other text." },
        { role: "user", content: retryPrompt },
      ],
      0.1,
      200,
    )

    const cleaned = retryRaw.replace(/```json\s*|```/g, "").trim()
    const indices = JSON.parse(cleaned) as number[]
    if (Array.isArray(indices) && indices.length > 0) {
      return {
        selectedIndices: indices.filter((idx) => idx >= 0 && idx < capped.length),
        outline: "",
        sitemapHints: [],
        githubHints: [],
        initialAssessment: "",
      }
    }
  } catch {
    console.warn("[evaluate] Retry also failed, using snippet-relevance fallback")
  }
  return fallback
}

export async function evaluateResults(
  query: string,
  results: SearchResult[],
  largeModel: LlmConfig,
  warningPrompt?: string,
  researchType?: string,
): Promise<EvaluateResult> {
  const capped = results.slice(0, 15)

  const formatted = capped
    .map(
      (r, i) =>
        `[${i}] ${r.title}\n  URL: ${r.url}\n  Snippet: ${r.snippet.slice(0, 300)}\n  Source: ${r.source}\n  Quality: ${r.qualityScore}`,
    )
    .join("\n\n")

  const typeHint = researchType
    ? `\nThis is a "${researchType}" query. ${researchType === "api" || researchType === "code" ? "Prioritize official documentation, API reference pages, and GitHub repos with code examples." : researchType === "comparison" ? "Prioritize comparison articles, benchmark results, and documentation from multiple projects." : "Prioritize authoritative sources: official docs, well-known tech blogs, and detailed tutorials."}`
    : ""

  const userPrompt = `Research query: "${query}"
${typeHint}
${warningPrompt ? `Important note: ${warningPrompt}\n\n` : ""}Search results:
${formatted}

Select the 5-8 most relevant and authoritative results for deep reading to answer this query.

Return ONLY valid JSON matching this structure:
{
  "selectedIndices": [array of 0-based indices from the list above],
  "outline": "an initial outline of what the final answer should cover",
  "sitemapHints": ["URLs that look like documentation sites with subpages worth exploring"],
  "githubHints": ["URLs that are GitHub repositories"],
  "initialAssessment": "brief assessment of result quality and what's likely missing"
}`

  const systemPrompt =
    "You are a research evaluation assistant. You analyze search results and select the most valuable ones for deep reading.\n\nCRITICAL: Your response must contain ONLY a single JSON object. No explanation, no markdown, no extra text before or after the JSON. Start with { and end with }."

  const raw = await callLlm(
    largeModel,
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    0.2,
    800,
  )

  let parsed: EvaluateResult
  try {
    const cleaned = raw.replace(/```json\s*|```/g, "").trim()
    parsed = JSON.parse(cleaned) as EvaluateResult
  } catch {
    // Secondary attempt: extract JSON object from surrounding text
    const extracted = extractJsonObject(raw)
    if (extracted) {
      try {
        parsed = JSON.parse(extracted) as EvaluateResult
      } catch {
        // Tertiary attempt: retry with simplified prompt
        parsed = await retryEvaluateSimple(query, capped, largeModel)
      }
    } else {
      // Tertiary attempt: retry with simplified prompt
      parsed = await retryEvaluateSimple(query, capped, largeModel)
    }
  }

  parsed.selectedIndices = parsed.selectedIndices.filter(
    (idx) => idx >= 0 && idx < capped.length,
  )

  return parsed
}
