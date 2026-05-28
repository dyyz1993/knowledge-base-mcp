import type { FilterResult } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"
import type { SearchResult } from "../../search/types"
import { extractJsonArray } from "../utils/json-parser.js"
import { createLogger } from "../../utils/logger.js"

const logger = createLogger("research:steps:filter-results")

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
  const extracted = extractJsonArray(raw)
  if (!extracted) return []
  try {
    const parsed = JSON.parse(extracted)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item: unknown): item is FilterResult =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as FilterResult).index === "number" &&
        typeof (item as FilterResult).relevanceScore === "number" &&
        typeof (item as FilterResult).reason === "string",
    )
  } catch (err) {
    logger.warn("JSON parse failed in filterResults parseResponse", { error: String(err) })
    return []
  }
}

function fallbackTopResults(results: SearchResult[]): SearchResult[] {
  return [...results]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 15)
}

const BATCH_SIZE = 7

async function scoreBatch(
  query: string,
  batch: SearchResult[],
  batchOffset: number,
  smallModel: LlmConfig,
  warningPrompt?: string,
): Promise<FilterResult[]> {
  const formatted = formatResults(batch)
  const warningLine = warningPrompt ? `\nAdditional context: ${warningPrompt}` : ""
  const fullPrompt = buildUserPrompt(query, formatted) + warningLine

  const raw = await callLlm(
    smallModel,
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: fullPrompt },
    ],
    0.1,
    1500,
    60_000,
  )

  if (!raw) return []

  const filterData = parseResponse(raw)
  return filterData.map(f => ({ ...f, index: f.index + batchOffset }))
}

export async function filterResults(
  query: string,
  results: SearchResult[],
  smallModel: LlmConfig,
  warningPrompt?: string,
): Promise<SearchResult[]> {
  if (results.length === 0) return []

  const capped = results.slice(0, 20)

  try {
    const batches: SearchResult[][] = []
    for (let i = 0; i < capped.length; i += BATCH_SIZE) {
      batches.push(capped.slice(i, i + BATCH_SIZE))
    }

    const batchPromises = batches.map((batch, batchIdx) =>
      scoreBatch(query, batch, batchIdx * BATCH_SIZE, smallModel, warningPrompt),
    )
    const batchResults = await Promise.all(batchPromises)
    const allFilterData = batchResults.flat()

    const scored = allFilterData
      .filter((f) => f.relevanceScore >= 5)
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, 15)
      .map((f) => capped[f.index])
      .filter((r): r is SearchResult => r !== undefined)

    return scored.length > 0 ? scored : fallbackTopResults(results)
  } catch (err) {
    logger.warn("filterResults batch scoring failed, using fallback", { error: String(err) })
    return fallbackTopResults(results)
  }
}
