import type { EvaluateResult } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"
import type { SearchResult } from "../../search/types"

export async function evaluateResults(
  query: string,
  results: SearchResult[],
  largeModel: LlmConfig,
  warningPrompt?: string,
): Promise<EvaluateResult> {
  const capped = results.slice(0, 15)

  const formatted = capped
    .map(
      (r, i) =>
        `[${i}] ${r.title}\n  URL: ${r.url}\n  Snippet: ${r.snippet.slice(0, 300)}\n  Source: ${r.source}\n  Quality: ${r.qualityScore}`,
    )
    .join("\n\n")

  const userPrompt = `Research query: "${query}"

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
    1500,
  )

  let parsed: EvaluateResult
  try {
    const cleaned = raw.replace(/```json\s*|```/g, "").trim()
    parsed = JSON.parse(cleaned) as EvaluateResult
  } catch {
    return {
      selectedIndices: capped.slice(0, 5).map((_, i) => i),
      outline: "",
      sitemapHints: [],
      githubHints: [],
      initialAssessment: "",
    }
  }

  parsed.selectedIndices = parsed.selectedIndices.filter(
    (idx) => idx >= 0 && idx < capped.length,
  )

  return parsed
}
