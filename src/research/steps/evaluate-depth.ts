import type { DepthEvaluation, DeepReadItem, StepDecision } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"

function extractJson(text: string): string | null {
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {}

  let depth = 0
  let start = -1
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
          return candidate
        } catch {}
      }
    }
  }
  return null
}

export async function evaluateDepth(
  query: string,
  deepReadResults: DeepReadItem[],
  outline: string,
  mode: string,
  largeModel: LlmConfig,
  warningPrompt?: string,
): Promise<DepthEvaluation> {
  const contentSummary = deepReadResults
    .map((item) => {
      const preview = item.content.slice(0, 300)
      return `Title: ${item.title}\nURL: ${item.url}\nLength: ${item.content.length} chars\nPreview: ${preview}`
    })
    .join("\n\n---\n\n")

  const warningSection = warningPrompt ? `\n\nWARNING: ${warningPrompt}` : ""

  const userPrompt = `Evaluate this research:

QUERY: ${query}

CONTENT (${deepReadResults.filter(r => r.success).length}/${deepReadResults.length} URLs read):
${contentSummary || "(no content)"}

OUTLINE:
${outline || "(none)"}

MODE: ${mode}${warningSection}

Example response:
{"qualityScore":7,"coverageScore":6,"decision":"continue","reason":"Good overview but missing API details","nextTargets":["https://example.com/docs/api"],"updatedOutline":"## Topic\\n### 1. Overview\\n### 2. API"}

Now evaluate. Return ONLY the JSON object:
{"qualityScore":0-10,"coverageScore":0-10,"decision":"done|need_sitemap|need_github|need_more_search|continue","reason":"...","nextTargets":[],"updatedOutline":"..."}`

  const raw = await callLlm(
    largeModel,
    [
      {
        role: "system",
        content: "You are a research quality evaluator. Output ONLY valid JSON. No explanation before or after the JSON.",
      },
      { role: "user", content: userPrompt },
    ],
    0.2,
    1000,
  )

  const jsonStr = extractJson(raw)
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as DepthEvaluation
      const validDecisions: StepDecision[] = [
        "done", "need_sitemap", "need_github", "need_more_search", "continue",
      ]
      return {
        qualityScore: Math.max(0, Math.min(10, Number(parsed.qualityScore) || 5)),
        coverageScore: Math.max(0, Math.min(10, Number(parsed.coverageScore) || 5)),
        decision: validDecisions.includes(parsed.decision) ? parsed.decision : "continue",
        reason: String(parsed.reason || ""),
        nextTargets: Array.isArray(parsed.nextTargets) ? parsed.nextTargets.map(String) : [],
        updatedOutline: String(parsed.updatedOutline || outline),
      }
    } catch {}
  }

  return {
    qualityScore: 5,
    coverageScore: 5,
    decision: "done",
    reason: `evaluation parse failed (raw: ${raw.slice(0, 100)})`,
    nextTargets: [],
    updatedOutline: outline,
  }
}
