import type { FilterResult } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"
import type { SearchResult } from "../../search/types"

const SYSTEM_PROMPT =
  "You are a search result relevance evaluator. You assess how relevant each search result is to a given query. Always respond with valid JSON only."

function buildUserPrompt(query: string, formattedResults: string): string {
  return `Evaluate the relevance of each search result to the query.

Query: "${query}"

Results:
${formattedResults}

Return a JSON array where each element has:
{ "index": number, "relevanceScore": number (0-10), "reason": string }

Rules:
- Score 0-3: Not relevant
- Score 4-5: Marginally relevant
- Score 6-7: Relevant
- Score 8-10: Highly relevant
- Evaluate based on: topical match, authority of source, recency indication, and completeness of information
- Output ONLY valid JSON. No markdown, no explanation.`
}

function formatResults(results: SearchResult[]): string {
  return results
    .slice(0, 20)
    .map(
      (r, i) =>
        `[${i}] ${r.title}\n  URL: ${r.url}\n  Snippet: ${r.snippet.slice(0, 200)}`,
    )
    .join("\n\n")
}

function parseResponse(raw: string): FilterResult[] {
  try {
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item: unknown): item is FilterResult =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FilterResult).index === "number" &&
        typeof (item as FilterResult).relevanceScore === "number" &&
        typeof (item as FilterResult).reason === "string",
    )
  } catch {
    return []
  }
}

function fallbackTopResults(results: SearchResult[]): SearchResult[] {
  return [...results]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 15)
}

export async function filterResults(
  query: string,
  results: SearchResult[],
  smallModel: LlmConfig,
  warningPrompt?: string,
): Promise<SearchResult[]> {
  if (results.length === 0) return []

  const capped = results.slice(0, 30)
  const formatted = formatResults(capped)

  const warningLine = warningPrompt ? `\nAdditional context: ${warningPrompt}` : ""
  const fullPrompt = buildUserPrompt(query, formatted) + warningLine

  try {
    const raw = await callLlm(
      smallModel,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: fullPrompt },
      ],
      0.1,
      1500,
    )

    if (!raw) return fallbackTopResults(results)

    const filterData = parseResponse(raw)

    const scored = filterData
      .filter((f) => f.relevanceScore >= 5)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 15)
      .map((f) => capped[f.index])
      .filter((r): r is SearchResult => r !== undefined)

    return scored.length > 0 ? scored : fallbackTopResults(results)
  } catch {
    return fallbackTopResults(results)
  }
}
