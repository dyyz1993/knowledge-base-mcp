import type { DepthEvaluation, DeepReadItem, StepDecision } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"

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
      return `Title: ${item.title}\nURL: ${item.url}\nContent length: ${item.content.length} chars\nPreview: ${preview}`
    })
    .join("\n\n---\n\n")

  const warningSection = warningPrompt ? `\n\nWARNING: ${warningPrompt}` : ""

  const userPrompt = `Given the following research context:

QUERY: ${query}

DEEP-READ CONTENT SUMMARY:
${contentSummary || "(no content read yet)"}

CURRENT OUTLINE:
${outline || "(no outline yet)"}

RESEARCH MODE: ${mode}
${warningSection}

Evaluate the collected content and respond with valid JSON only:

1. qualityScore (0-10): Rate accuracy, depth, and usefulness of the content
2. coverageScore (0-10): Rate how completely the content answers the query
3. decision: Choose one of:
   - "done" if qualityScore >= 8 and coverageScore >= 7
   - "need_sitemap" if results came from a doc site but we only read the homepage
   - "need_github" if a GitHub repo was found but not analyzed
   - "need_more_search" if qualityScore < 5 (need different search terms)
   - "continue" if there is more to read but current direction is right
4. reason: Brief explanation of the decision
5. nextTargets: Array of URLs or paths to follow if not "done", otherwise []
6. updatedOutline: Updated outline incorporating new knowledge

Respond with ONLY the JSON object matching this shape:
{"qualityScore": number, "coverageScore": number, "decision": string, "reason": string, "nextTargets": string[], "updatedOutline": string}`

  const raw = await callLlm(
    largeModel,
    [
      {
        role: "system",
        content:
          "You are a research quality evaluator. You assess whether collected content is sufficient to answer a query. Always respond with valid JSON only.",
      },
      { role: "user", content: userPrompt },
    ],
    0.2,
    1000,
  )

  try {
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
    const parsed = JSON.parse(cleaned) as DepthEvaluation

    const validDecisions: StepDecision[] = [
      "done",
      "need_sitemap",
      "need_github",
      "need_more_search",
      "continue",
    ]
    if (!validDecisions.includes(parsed.decision)) {
      parsed.decision = "continue"
    }

    return {
      qualityScore: Math.max(0, Math.min(10, Number(parsed.qualityScore) || 5)),
      coverageScore: Math.max(0, Math.min(10, Number(parsed.coverageScore) || 5)),
      decision: parsed.decision,
      reason: String(parsed.reason || ""),
      nextTargets: Array.isArray(parsed.nextTargets)
        ? parsed.nextTargets.map(String)
        : [],
      updatedOutline: String(parsed.updatedOutline || outline),
    }
  } catch {
    return {
      qualityScore: 5,
      coverageScore: 5,
      decision: "done",
      reason: "evaluation parse failed",
      nextTargets: [],
      updatedOutline: outline,
    }
  }
}
