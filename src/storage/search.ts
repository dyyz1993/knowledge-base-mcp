import { readFileSync, existsSync } from "node:fs"
import { readIndex, type IndexFile } from "./index"
import type { DocMeta } from "./index"
import { tfidfSearch, buildIDF } from "../search/tfidf"
import { semanticSearch, docToSearchableText } from "../search/embedding"
import { fuzzySearch } from "../search/fuzzy-search"
import { recordSearchTime, recordSearch } from "../search/perf-metrics"
import { loadVectors, indexDoc, checkAndUpdateModel } from "../search/vector-store"
import { loadConfig, getKbDir } from "../config"
import { createLogger } from "../utils/logger.js"
import { tokenize } from "../utils/tokenizer"
import { MAX_SEARCH_LIMIT } from "../search/constants"
import { parseFrontmatter } from "./markdown"

const logger = createLogger("storage:search")

function readDocContent(filePath: string): string {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const { content } = parseFrontmatter(raw)
    return content
  } catch (e) {
    logger.warn("readDocContent: failed to read file: " + filePath, e instanceof Error ? e.message : String(e))
    return ""
  }
}

function extractSnippet(content: string, q: string, radius = 120): string {
  const lower = content.toLowerCase()
  const tokens = tokenize(q, { lowercase: true, splitChars: "-_" })
  let bestPos = -1
  for (const token of tokens) {
    const pos = lower.indexOf(token)
    if (pos !== -1) { bestPos = pos; break }
  }
  if (bestPos === -1) return content.slice(0, radius * 2)
  const start = Math.max(0, bestPos - radius)
  const end = Math.min(content.length, bestPos + radius)
  let snippet = content.slice(start, end).replace(/\n/g, " ")
  if (start > 0) snippet = "..." + snippet
  if (end < content.length) snippet = snippet + "..."
  return snippet
}

function tokenMatch(text: string, token: string): boolean {
  if (token.length <= 3) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(
      `(?:^|[\\s,，.。:：/\\\\|\\-_=+\\[\\](){}"'\\\`\\n\\r])${escaped}(?:[\\s,，.。:：/\\\\|\\-_=+\\[\\](){}"'\\\`\\n\\r]|$)`,
      "i",
    ).test(text)
  }
  return text.toLowerCase().includes(token)
}

function computeQualityMetrics(content: string): { contentLength: number; codeBlockCount: number; qualityBoost: number } {
  const contentLength = content.length
  const codeBlockCount = Math.floor(((content.match(/```/g) || []).length) / 2)
  let qualityBoost = 0
  qualityBoost += Math.min(codeBlockCount, 3) * 3
  if (contentLength >= 3000) qualityBoost += 5
  else if (contentLength >= 2000) qualityBoost += 4
  else if (contentLength >= 500) qualityBoost += 2
  return { contentLength, codeBlockCount, qualityBoost }
}

function contentQualityBoost(doc: DocMeta): number {
  if (doc.quality_boost !== undefined) return doc.quality_boost
  const body = readDocContent(doc.file_path)
  if (!body) return 0
  return computeQualityMetrics(body).qualityBoost
}

export function searchDocs(
  query?: string,
  keywords?: string[],
  tags?: string[],
  limit = 10,
): (DocMeta & { score: number; snippet?: string; matched_by: string[] })[] {
  const idx = readIndex()
  const q = (query || "").toLowerCase()
  const results: (DocMeta & { score: number; snippet?: string; matched_by: string[] })[] = []

  for (const doc of Object.values(idx.documents)) {
    let score = 0
    let snippet = ""
    const matched_by: string[] = []
    const body = readDocContent(doc.file_path).toLowerCase()

    if (q) {
      const tokens = tokenize(q, { lowercase: true, splitChars: "-_" })
      let matchedTokenCount = 0
      for (const token of tokens) {
        let tokenHit = false
        if (tokenMatch(doc.title, token)) { score += 10; if (!matched_by.includes("title")) matched_by.push("title"); tokenHit = true }
        if (doc.keywords.some(k => tokenMatch(k, token))) { score += 4; if (!matched_by.includes("keywords")) matched_by.push("keywords"); tokenHit = true }
        if (tokenMatch(doc.intent, token)) { score += 5; if (!matched_by.includes("intent")) matched_by.push("intent"); tokenHit = true }
        if (tokenMatch(doc.project_description, token)) { score += 1; if (!matched_by.includes("project_description")) matched_by.push("project_description"); tokenHit = true }
        if (body.includes(token)) { score += 2; if (!matched_by.includes("content")) matched_by.push("content"); tokenHit = true }
        if (tokenHit) matchedTokenCount++
      }
      if (tokens.length > 1) {
        if (tokenMatch(doc.title, q)) score += 8
        if (doc.keywords.some(k => k.toLowerCase().includes(q))) score += 5
        if (tokenMatch(doc.intent, q)) score += 3
        if (tokenMatch(doc.project_description, q)) score += 2
        if (body.includes(q)) score += 4
        if (matchedTokenCount === tokens.length) {
          score += Math.round(tokens.length * 6)
        } else if (matchedTokenCount < tokens.length) {
          const coverageRatio = matchedTokenCount / tokens.length
          if (coverageRatio < 0.5) {
            score = Math.round(score * coverageRatio)
          }
        }
      }
      if (body && tokens.some(t => body.includes(t))) {
        snippet = extractSnippet(readDocContent(doc.file_path), q)
      }
    }
    if (tags?.length) {
      if (doc.tags.some(t => tags.includes(t))) { score += 5; if (!matched_by.includes("tags")) matched_by.push("tags") }
    }
    if (keywords?.length) {
      if (doc.keywords.some(k => keywords.some(kw => tokenMatch(k, kw)))) { score += 3; if (!matched_by.includes("keywords")) matched_by.push("keywords") }
    }
    if (score > 0) {
      score += contentQualityBoost(doc)
      results.push({ ...doc, score, snippet, matched_by })
    }
  }

  const config = loadConfig()
  return results.sort((a, b) => b.score - a.score).slice(0, limit).filter(r => r.score >= config.search.minScore)
}

export function searchDocsAdvanced(query: string, limit = 10): (DocMeta & { score: number })[] {
  const idx = readIndex()
  const docs = Object.values(idx.documents)
  if (!query || docs.length === 0) return []
  const idf = buildIDF(docs)
  return tfidfSearch(query, docs, idf, limit)
}

export async function searchDocsSemantic(query: string, limit = 10): Promise<(DocMeta & { score: number })[]> {
  const idx = readIndex()
  const docs = Object.values(idx.documents)
  if (!query || docs.length === 0) return []

  const config = loadConfig()
  const currentModel = config.embedding.model || "local"
  const currentDims = config.embedding.dimensions

  if (checkAndUpdateModel(currentModel, currentDims)) {
    logger.warn("searchDocsSemantic: embedding model/dimension mismatch detected. Use POST /api/embedding/reindex to rebuild.")
  }

  const vectors = loadVectors()
  const missing = docs.filter(d => !vectors[d.id])
  if (missing.length > 0) {
    for (const doc of missing) {
      await indexDoc(doc.id, docToSearchableText(doc))
    }
  }

  const allVectors = loadVectors()

  if (currentDims > 0) {
    const mismatched = docs.filter(d => allVectors[d.id] && allVectors[d.id].length !== currentDims)
    if (mismatched.length > 0) {
      logger.warn(`searchDocsSemantic: ${mismatched.length} docs have mismatched dimensions, skipping semantic. Use POST /api/embedding/reindex to rebuild.`)
      return []
    }
  }

  const finalVectors = loadVectors()
  const docsVecs = docs
    .filter(d => finalVectors[d.id])
    .map(d => ({ meta: d, embedding: finalVectors[d.id] }))

  return semanticSearch(query, docsVecs, limit)
}

export async function searchDocsCombined(
  query: string,
  keywords?: string[],
  tags?: string[],
  limit = 10,
): Promise<(DocMeta & { score: number })[]> {
  const config = loadConfig()
  const searchMode = config.search.mode
  const weights = config.search.weights

  if (searchMode === "tfidf") {
    const idx = readIndex()
    const allDocs = Object.values(idx.documents)
    const idf = buildIDF(allDocs)
    return tfidfSearch(query, allDocs, idf, limit)
  }

  if (searchMode === "semantic") {
    try {
      return await Promise.race([
        searchDocsSemantic(query, limit),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("semantic search timeout")), 8000)),
      ])
    } catch {
      return searchDocs(query, keywords, tags, limit)
    }
  }

  const t0_token = Date.now()
  const [p0Settled, p1Settled, p2Settled, p3Settled] = await Promise.allSettled([
    Promise.resolve((() => { const r = searchDocs(query, keywords, tags, limit * 2); recordSearchTime("token", Date.now() - t0_token); return r })()),
    Promise.resolve((() => { const t0 = Date.now(); const idx = readIndex(); const allDocs = Object.values(idx.documents); const idf = buildIDF(allDocs); const r = tfidfSearch(query, allDocs, idf, limit * 2); recordSearchTime("tfidf", Date.now() - t0); return r })()),
    Promise.race([
      (() => { const t0 = Date.now(); return searchDocsSemantic(query, limit * 2).then(r => { recordSearchTime("semantic", Date.now() - t0); return r }) })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("semantic search timeout")), 8000)),
    ]),
    Promise.resolve((() => { const t0 = Date.now(); const localIdx = readIndex(); const r = fuzzySearch(query, limit * 2).map(fr => localIdx.documents[fr.id] ? { ...localIdx.documents[fr.id], score: fr.score * 0.3 } : null).filter(Boolean) as (DocMeta & { score: number })[]; recordSearchTime("fuzzy", Date.now() - t0); return r })()),
  ])

  const p0Results = p0Settled.status === "fulfilled" ? p0Settled.value : []
  const p1Results = p1Settled.status === "fulfilled" ? p1Settled.value : []
  const p2Results = p2Settled.status === "fulfilled" ? p2Settled.value : []
  const p3Results = p3Settled.status === "fulfilled" ? p3Settled.value : []

  if (p0Settled.status === "rejected") {
    logger.warn("searchDocsCombined: token search failed:", p0Settled.reason instanceof Error ? p0Settled.reason.message : String(p0Settled.reason))
  }
  if (p1Settled.status === "rejected") {
    logger.warn("searchDocsCombined: tfidf search failed:", p1Settled.reason instanceof Error ? p1Settled.reason.message : String(p1Settled.reason))
  }
  if (p2Settled.status === "rejected") {
    logger.warn("searchDocsCombined: semantic search failed, skipping:", p2Settled.reason instanceof Error ? p2Settled.reason.message : String(p2Settled.reason))
  }
  if (p3Settled.status === "rejected") {
    logger.warn("searchDocsCombined: fuzzy search failed:", p3Settled.reason instanceof Error ? p3Settled.reason.message : String(p3Settled.reason))
  }

  const combined = new Map<string, DocMeta & { score: number }>()

  const addScores = (results: (DocMeta & { score: number })[], weight: number) => {
    for (const r of results) {
      const existing = combined.get(r.id)
      if (existing) {
        existing.score += r.score * weight
      } else {
        combined.set(r.id, { ...r, score: r.score * weight })
      }
    }
  }

  const normalize = (results: (DocMeta & { score: number })[]): (DocMeta & { score: number })[] => {
    if (results.length === 0) return results
    const scores = results.map(r => r.score)
    let min = Infinity
    let max = -Infinity
    for (const s of scores) {
      if (s < min) min = s
      if (s > max) max = s
    }
    const range = max - min
    if (range === 0) return results.map(r => ({ ...r, score: 0.5 }))
    return results.map(r => ({ ...r, score: (r.score - min) / range }))
  }

  addScores(normalize(p0Results), weights.token)
  addScores(normalize(p1Results), weights.tfidf)
  addScores(normalize(p2Results), weights.semantic)
  addScores(normalize(p3Results), weights.fuzzy)

  const finalResults = Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .filter(r => r.score >= config.search.combinedMinScore)
    .slice(0, limit)

  recordSearch(finalResults.length)

  return finalResults
}
