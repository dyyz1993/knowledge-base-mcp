import type { DepthEvaluation, DeepReadItem, StepDecision } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"
import { extractJsonObject } from "../utils/json-parser.js"
import { createLogger } from "../../utils/logger.js"

/** Enhanced JSON extraction with trailing-comma fix for LLM responses */

const logger = createLogger("research:steps:evaluate-depth")
function extractJson(text: string): string | null {
  const extracted = extractJsonObject(text)
  if (extracted) return extracted
  // Additional fix: try to repair trailing commas
  if (!text || !text.trim()) return null
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  if (!cleaned.includes("{")) return null
  const braceStart = cleaned.indexOf("{")
  const partial = cleaned.slice(braceStart)
  const fixed = partial.replace(/[,]\s*([}\]])/g, "$1").replace(/\}\s*$/, "}")
  if (fixed.startsWith("{")) {
    try { JSON.parse(fixed); return fixed } catch {}
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
      // Show structured preview: first 400 + headings + tail 200 for long content
      let preview: string
      if (item.content.length > 1200) {
        const headings = (item.content.match(/^#{1,3}\s+.+$/gm) || []).slice(0, 8).join(" | ")
        const start = item.content.slice(0, 400)
        const end = item.content.slice(-200)
        preview = `${start}\n...[truncated ${item.content.length - 600} chars]...\n${end}`
        if (headings) preview += `\nHeadings: ${headings}`
      } else {
        preview = item.content.slice(0, 800)
      }
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
{"qualityScore":7,"coverageScore":6,"decision":"continue","reason":"Good overview but missing API details","nextTargets":["https://example.com/docs/api"],"updatedOutline":"## Topic\\n### 1. Overview\\n### 2. API","missingTopics":["API reference","code examples"]}

Now evaluate. Return ONLY the JSON object:
{"qualityScore":0-10,"coverageScore":0-10,"decision":"done|need_sitemap|need_github|need_more_search|continue","reason":"...","nextTargets":[],"updatedOutline":"...","missingTopics":["topic1","topic2"]}`

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
    60000,
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
        decision: (() => {
          const d = parsed.decision
          if (d === "continue" && (Number(parsed.qualityScore) || 5) < 5 && (parsed.missingTopics?.length || 0) > 5) {
            return "need_more_search"
          }
          return validDecisions.includes(d) ? d : "continue"
        })(),
        reason: String(parsed.reason || ""),
        nextTargets: Array.isArray(parsed.nextTargets) ? parsed.nextTargets.map(String) : [],
        updatedOutline: String(parsed.updatedOutline || outline),
        missingTopics: Array.isArray(parsed.missingTopics) ? parsed.missingTopics.map(String) : [],
      }
    } catch (e) {
      logger.warn(e instanceof Error ? e.message : String(e))
    }
  }

  // If LLM returned empty/whitespace, terminate rather than waste budget looping
  if (!raw || !raw.trim()) {
    return {
      qualityScore: 4,
      coverageScore: 4,
      decision: "done",
      reason: "LLM returned empty response, terminating to avoid budget waste",
      nextTargets: [],
      updatedOutline: outline,
      missingTopics: [],
    }
  }

  return {
    qualityScore: 5,
    coverageScore: 5,
    decision: "done",
    reason: `evaluation parse failed (raw: ${raw.slice(0, 100)})`,
    nextTargets: [],
    updatedOutline: outline,
    missingTopics: [],
  }
}
