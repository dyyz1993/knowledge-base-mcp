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
  return score
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

  const raw = await callLlm(
    largeModel,
    [
      {
        role: "system",
        content:
          "You are a research evaluation assistant. You analyze search results and select the most valuable ones for deep reading. Always respond with valid JSON only.",
      },
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
        // Both attempts failed — use relevance-based fallback
        console.warn("[evaluate] JSON parse failed, using snippet-relevance fallback")
        const ranked = capped
          .map((r, i) => ({ i, score: snippetRelevance(query, r) }))
          .sort((a, b) => b.score - a.score)
        return {
          selectedIndices: ranked.slice(0, 5).map((r) => r.i),
          outline: "",
          sitemapHints: [],
          githubHints: [],
          initialAssessment: "",
        }
      }
    } else {
      // No JSON found at all — use relevance-based fallback
      console.warn("[evaluate] No JSON found in LLM response, using snippet-relevance fallback")
      const ranked = capped
        .map((r, i) => ({ i, score: snippetRelevance(query, r) }))
        .sort((a, b) => b.score - a.score)
      return {
        selectedIndices: ranked.slice(0, 5).map((r) => r.i),
        outline: "",
        sitemapHints: [],
        githubHints: [],
        initialAssessment: "",
      }
    }
  }

  parsed.selectedIndices = parsed.selectedIndices.filter(
    (idx) => idx >= 0 && idx < capped.length,
  )

  return parsed
}
