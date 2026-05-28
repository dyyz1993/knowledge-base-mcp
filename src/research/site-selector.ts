import { callLlm, type LlmConfig } from "../search/llm-caller"
import type { SiteEntry } from "./site-registry"
import { findSitesByTopics, SITE_REGISTRY } from "./site-registry"
import { extractJsonObject } from "./utils/json-parser.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("research:site-selector")

const SYSTEM_PROMPT = `You are a research site selector. Given a research query and a list of authoritative websites, select the 2-5 most relevant sites for deep reading. Return ONLY valid JSON, no markdown.`

function buildUserPrompt(query: string, candidateSites: SiteEntry[]): string {
  const siteList = candidateSites.map((s, i) =>
    `[${i}] ${s.name} (${s.url}) — topics: ${s.topics.join(", ")} — ${s.description}`
  ).join("\n")

  return `Research query: "${query}"

Available authoritative sites:
${siteList}

Select the 2-5 most relevant sites for answering this query. For each selected site, provide:
- index: the site index from the list above
- reason: brief reason why this site is relevant

Return ONLY JSON: {"selections":[{"index":0,"reason":"..."}]}`
}

export interface SiteSelection {
  site: SiteEntry
  reason: string
}

export async function selectSites(
  query: string,
  model: LlmConfig,
  preselectedTopics?: string[],
): Promise<SiteSelection[]> {
  let candidates = preselectedTopics?.length
    ? findSitesByTopics(preselectedTopics)
    : SITE_REGISTRY.slice(0, 30)

  if (candidates.length === 0) {
    candidates = SITE_REGISTRY.slice(0, 30)
  }

  if (candidates.length <= 3) {
    return candidates.map(s => ({ site: s, reason: "auto-matched by topic" }))
  }

  try {
    const raw = await callLlm(
      model,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(query, candidates) },
      ],
      0.2,
      600,
      30_000,
    )

    const jsonStr = extractJsonObject(raw)
    if (!jsonStr) {
      logger.warn("Failed to parse LLM site selection response")
      return fallback(query, candidates)
    }

    const parsed = JSON.parse(jsonStr) as {
      selections?: Array<{ index?: number; reason?: string }>
    }

    if (!Array.isArray(parsed.selections) || parsed.selections.length === 0) {
      return fallback(query, candidates)
    }

    return parsed.selections
      .filter(s => typeof s.index === "number" && s.index >= 0 && s.index < candidates.length)
      .map(s => ({
        site: candidates[s.index!],
        reason: s.reason || "LLM selected",
      }))
      .slice(0, 5)
  } catch (e) {
    logger.warn(`Site selection failed: ${e instanceof Error ? e.message : e}`)
    return fallback(query, candidates)
  }
}

function fallback(query: string, candidates: SiteEntry[]): SiteSelection[] {
  const qLower = query.toLowerCase()
  const scored = candidates.map(site => {
    const topics = site.topics.join(" ")
    const desc = site.description.toLowerCase()
    const matchCount = qLower.split(/\s+/).filter(w => w.length > 2 && (topics.includes(w) || desc.includes(w))).length
    return { site, score: matchCount }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3).filter(s => s.score > 0).map(s => ({ site: s.site, reason: "keyword-matched" }))
}
