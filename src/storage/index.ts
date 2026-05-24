import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, renameSync } from "node:fs"
import { randomUUID } from "node:crypto"
import YAML from "yaml"
import { parseFrontmatter, buildFrontmatter } from "./markdown"
import { tfidfSearch, buildIDF, invalidateIDFCache } from "../search/tfidf"
import { semanticSearch, docToSearchableText, embed } from "../search/embedding"
import { loadVectors, indexDoc, rebuildAllVectors, initDb, checkAndUpdateModel } from "../search/vector-store"
import { loadConfig, getKbDir } from "../config"
import { createLogger } from "../utils/logger.js"
import { tokenize } from "../utils/tokenizer"
import { MAX_SEARCH_LIMIT } from "../search/constants"

/** Dynamic paths — always read KB_DIR from env at call time for test isolation */

const logger = createLogger("storage:index")
function getIndexPath(): string { return `${getKbDir()}/index.json` }
function getMissLogPath(): string { return `${getKbDir()}/miss-log.json` }

export interface DocMeta {
  id: string
  title: string
  tags: string[]
  keywords: string[]
  intent: string
  project_description: string
  project_path?: string
  source_project?: string
  source_worktree?: string
  related_projects?: string[]
  related_files?: string[]
  created_at: number
  updated_at?: number
  file_path: string
  content_length?: number
  code_block_count?: number
  quality_boost?: number
}

export interface IndexFile {
  version: number
  documents: Record<string, DocMeta>
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

let cachedIndex: IndexFile | null = null
let cacheTimestamp = 0
let cachedCacheTtl = 5000
let cacheTtlConfigTimestamp = 0

function getCacheTtlMs(): number {
  const now = Date.now()
  if (now - cacheTtlConfigTimestamp > 60000) {
    try { cachedCacheTtl = loadConfig().storage.cacheTtlMs } catch (e) { logger.debug('Load cacheTtlMs config failed:', e) }
    cacheTtlConfigTimestamp = now
  }
  return cachedCacheTtl
}

// Write serialization: prevents TOCTOU races while keeping writes synchronous
// when no concurrent write is in progress (critical for test compatibility)
let writing = false
const pendingWrites: Array<() => void> = []

function serializedWrite(fn: () => void): void {
  if (!writing) {
    writing = true
    try {
      fn()
    } finally {
      writing = false
      while (pendingWrites.length > 0) {
        const next = pendingWrites.shift()!
        writing = true
        try { next() } finally { writing = false }
      }
    }
  } else {
    pendingWrites.push(fn)
  }
}

function readIndex(): IndexFile {
  ensureDir(getKbDir())
  const now = Date.now()

  // Use cache if fresh (< 5s old)
  if (cachedIndex && (now - cacheTimestamp) < getCacheTtlMs()) return cachedIndex

  try {
    const raw = readFileSync(getIndexPath(), "utf-8")
    const idx = JSON.parse(raw) as IndexFile
    cachedIndex = idx
    cacheTimestamp = now
    return idx
  } catch (e) {
    logger.warn("readIndex: index file missing or corrupted, attempting recovery:", e instanceof Error ? e.message : String(e))
    const recovered = recoverIndexFromDisk()
    if (recovered && Object.keys(recovered.documents).length > 0) {
      cachedIndex = recovered
      cacheTimestamp = now
      atomicWriteIndex(recovered)
      return recovered
    }
    // No recovery possible — start fresh
    const idx: IndexFile = { version: 1, documents: {} }
    cachedIndex = idx
    cacheTimestamp = now
    atomicWriteIndex(idx)
    return idx
  }
}

/** Force re-read from disk on next readIndex() call — use before writes */
function invalidateCache() {
  cachedIndex = null
  cacheTimestamp = 0
}

function atomicWriteIndex(idx: IndexFile) {
  const tmpPath = getIndexPath() + ".tmp"
  writeFileSync(tmpPath, JSON.stringify(idx, null, 2))
  renameSync(tmpPath, getIndexPath())
}

function writeIndex(idx: IndexFile) {
  cachedIndex = idx
  cacheTimestamp = Date.now()
  serializedWrite(() => atomicWriteIndex(idx))
}

/**
 * Recover index from .md files on disk when index.json is corrupted or missing.
 * Each .md file has YAML frontmatter with full metadata.
 */
function recoverIndexFromDisk(): IndexFile | null {
  try {
    const files = readdirSync(getKbDir()).filter(f => f.endsWith(".md"))
    if (files.length === 0) return null

    const idx: IndexFile = { version: 1, documents: {} }
    for (const file of files) {
      try {
        const raw = readFileSync(`${getKbDir()}/${file}`, "utf-8")
        const { frontmatter } = parseFrontmatterWithMeta(raw)
        if (frontmatter?.id && frontmatter?.title) {
          idx.documents[frontmatter.id as string] = frontmatter as unknown as DocMeta
        }
      } catch (e) {
        logger.warn("recoverIndexFromDisk: skipping unreadable file:", e instanceof Error ? e.message : String(e))
      }
    }
    return idx
  } catch (e) {
    logger.warn("recoverIndexFromDisk: failed to read knowledge dir:", e instanceof Error ? e.message : String(e))
    return null
  }
}

function parseFrontmatterWithMeta(raw: string): { frontmatter: Record<string, unknown> | null; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: null, content: raw }
  try {
    return { frontmatter: YAML.parse(match[1]) as Record<string, unknown>, content: match[2] }
  } catch {
    return { frontmatter: null, content: raw }
  }
}

export function generateId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16)
}

export function slugify(s: string): string {
  let slug = s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
  if (!slug) slug = generateId().slice(0, 8)
  return slug
}

function docFilePath(id: string, title: string) {
  return `${getKbDir()}/${id}-${slugify(title)}.md`
}

export function findDuplicate(meta: { title: string; source_project?: string }, idx: IndexFile): DocMeta | null {
  return Object.values(idx.documents).find(
    d => d.title === meta.title && d.source_project === (meta.source_project || "")
  ) || null
}

export function writeDoc(
  meta: Omit<DocMeta, "id" | "file_path" | "created_at"> & { id?: string; file_path?: string; created_at?: number },
  content: string,
): DocMeta {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`writeDoc: content must be a non-empty string, got: ${typeof content} (${String(content).slice(0, 50)})`)
  }

  // Invalidate cache to get latest from disk (multi-process safety)
  invalidateCache()
  const idx = readIndex()
  const existing = !meta.id ? findDuplicate({ title: meta.title, source_project: meta.source_project || "" }, idx) : null
  const id = meta.id || existing?.id || generateId()
  const created_at = meta.created_at || existing?.created_at || Date.now()
  const file_path = meta.file_path || existing?.file_path || docFilePath(id, meta.title)
  const updated_at = Date.now()

  if (existing) {
    if (existsSync(existing.file_path) && existing.file_path !== file_path) {
      unlinkSync(existing.file_path)
    }
  }

  const doc: DocMeta = {
    ...meta,
    id,
    created_at,
    updated_at,
    file_path,
    project_path: meta.project_path || meta.source_project || "",
    related_projects: meta.related_projects || [],
    related_files: meta.related_files || [],
  } as DocMeta

  ensureDir(getKbDir())
  const md = buildFrontmatter(doc) + "\n" + content

  const metrics = computeQualityMetrics(content)
  doc.content_length = metrics.contentLength
  doc.code_block_count = metrics.codeBlockCount
  doc.quality_boost = metrics.qualityBoost

  idx.documents[id] = doc
  serializedWrite(() => {
    writeFileSync(file_path, md)
    atomicWriteIndex(idx)
  })
  cachedIndex = idx
  cacheTimestamp = Date.now()
  updateOutline(doc.source_project || "", idx)

  indexDoc(id, docToSearchableText(doc)).catch(e => {
    logger.warn("writeDoc: async vector indexing failed:", e instanceof Error ? e.message : String(e))
  })

  invalidateIDFCache()

  return doc
}

export function readDoc(id: string, truncate = true): { meta: DocMeta; content: string; truncated: boolean } | null {
  const idx = readIndex()
  const meta = idx.documents[id]
  if (!meta) return null

  const raw = readFileSync(meta.file_path, "utf-8")
  const { content } = parseFrontmatter(raw)
  if (!truncate) return { meta, content, truncated: false }

  const lines = content.split("\n")
  const limit = MAX_SEARCH_LIMIT
  if (lines.length > limit) {
    return { meta, content: lines.slice(0, limit).join("\n"), truncated: true }
  }
  return { meta, content, truncated: false }
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
      const tokens = tokenize(q, { lowercase: false, splitChars: "-_" })
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
    logger.warn("searchDocsSemantic: auto-rebuilding all vectors due to model/dimension mismatch")
    await rebuildAllVectors(docs)
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
      logger.warn(`searchDocsSemantic: ${mismatched.length} docs have mismatched dimensions, triggering rebuild`)
      await rebuildAllVectors(docs)
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
      // Fallback to keyword search when semantic fails
      return searchDocs(query, keywords, tags, limit)
    }
  }

  const [p0Settled, p1Settled, p2Settled] = await Promise.allSettled([
    Promise.resolve(searchDocs(query, keywords, tags, limit * 2)),
    Promise.resolve((() => {
      const idx = readIndex()
      const allDocs = Object.values(idx.documents)
      const idf = buildIDF(allDocs)
      return tfidfSearch(query, allDocs, idf, limit * 2)
    })()),
    Promise.race([
      searchDocsSemantic(query, limit * 2),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("semantic search timeout")), 8000)),
    ]),
  ])

  const p0Results = p0Settled.status === "fulfilled" ? p0Settled.value : []
  const p1Results = p1Settled.status === "fulfilled" ? p1Settled.value : []
  const p2Results = p2Settled.status === "fulfilled" ? p2Settled.value : []

  if (p0Settled.status === "rejected") {
    logger.warn("searchDocsCombined: token search failed:", p0Settled.reason instanceof Error ? p0Settled.reason.message : String(p0Settled.reason))
  }
  if (p1Settled.status === "rejected") {
    logger.warn("searchDocsCombined: tfidf search failed:", p1Settled.reason instanceof Error ? p1Settled.reason.message : String(p1Settled.reason))
  }
  if (p2Settled.status === "rejected") {
    logger.warn("searchDocsCombined: semantic search failed, skipping:", p2Settled.reason instanceof Error ? p2Settled.reason.message : String(p2Settled.reason))
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

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
    .filter(r => r.score >= config.search.combinedMinScore)
    .slice(0, limit)
}

export function listDocs(tag?: string, project?: string): DocMeta[] {
  const idx = readIndex()
  return Object.values(idx.documents).filter(d => {
    if (tag && !d.tags.includes(tag)) return false
    if (project && d.source_project !== project) return false
    return true
  }).sort((a, b) => b.created_at - a.created_at)
}

export function listRecentDocs(options: {
  hours?: number
  since?: number
  limit?: number
  include_content?: boolean
}): { meta: DocMeta; content?: string; snippet: string }[] {
  const { hours = 24, since, limit = 50, include_content = false } = options
  const cutoff = since || (Date.now() - hours * 3600_000)
  const idx = readIndex()

  return Object.values(idx.documents)
    .filter(d => d.created_at >= cutoff)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, limit)
    .map(d => {
      const fullContent = readDocContent(d.file_path)
      const snippet = fullContent.length > 300 ? fullContent.slice(0, 300) + "..." : fullContent
      return {
        meta: d,
        ...(include_content ? { content: fullContent } : {}),
        snippet,
      }
    })
}

export function deleteDoc(id: string): boolean {
  invalidateCache()
  invalidateIDFCache()
  const idx = readIndex()
  const doc = idx.documents[id]
  if (!doc) return false

  if (existsSync(doc.file_path)) unlinkSync(doc.file_path)

  const project = doc.source_project || ""
  delete idx.documents[id]
  writeIndex(idx)
  updateOutline(project || "", idx)
  return true
}

export function getOutline(project: string): Record<string, unknown> | null {
  const slug = slugify(project)
  const path = `${getKbDir()}/outlines/${slug}.json`
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf-8"))
}

export function updateOutline(project: string, idx?: IndexFile): void {
  if (!project) return
  if (!idx) idx = readIndex()
  const slug = slugify(project)
  const dir = `${getKbDir()}/outlines`
  ensureDir(dir)

  const docs = Object.values(idx.documents)
    .filter(d => d.source_project === project)
    .sort((a, b) => b.created_at - a.created_at)
    .map(d => ({ id: d.id, title: d.title, tags: d.tags, keywords: d.keywords, intent: d.intent }))

  const outline = { project, updated_at: Date.now(), docs }
  writeFileSync(`${dir}/${slug}.json`, JSON.stringify(outline, null, 2))
}

export function listAllOutlines(): { project: string; name: string; doc_count: number; updated_at: number }[] {
  const dir = `${getKbDir()}/outlines`
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        const data = JSON.parse(readFileSync(`${dir}/${f}`, "utf-8"))
        const parts = data.project.split("/")
        return {
          project: data.project,
          name: parts[parts.length - 1] || data.project,
          doc_count: data.docs?.length || 0,
          updated_at: data.updated_at || 0,
        }
      } catch (e) {
        logger.warn("listAllOutlines: skipping unreadable outline file:", e instanceof Error ? e.message : String(e))
        return null
      }
    })
    .filter(Boolean) as { project: string; name: string; doc_count: number; updated_at: number }[]
}

export function getAllKeywords(): { keywords: string[]; count: number } {
  const idx = readIndex()
  const kwSet = new Set<string>()
  for (const doc of Object.values(idx.documents)) {
    for (const k of doc.keywords) kwSet.add(k)
  }
  return { keywords: [...kwSet].sort(), count: kwSet.size }
}

export { rebuildAllVectors }

// Miss log functions using getMissLogPath()

interface MissEntry {
  query: string
  timestamp: number
  resolved: boolean
}

function readMissLog(): MissEntry[] {
  try {
    if (!existsSync(getMissLogPath())) return []
    return JSON.parse(readFileSync(getMissLogPath(), "utf-8"))
  } catch (e) {
    logger.warn("readMissLog: failed to read miss log:", e instanceof Error ? e.message : String(e))
    return []
  }
}

function writeMissLog(log: MissEntry[]) {
  ensureDir(getKbDir())
  serializedWrite(() => {
    const tmpPath = getMissLogPath() + ".tmp"
    writeFileSync(tmpPath, JSON.stringify(log, null, 2))
    renameSync(tmpPath, getMissLogPath())
  })
}

export function recordMiss(query: string): { total_misses: number; recurring: boolean } {
  let log = readMissLog()
  const existing = log.find(e => e.query.toLowerCase() === query.toLowerCase())
  const recurring = !!existing
  if (existing) {
    existing.timestamp = Date.now()
  } else {
    log.push({ query, timestamp: Date.now(), resolved: false })
  }
  if (log.length > 1000) {
    log = log.slice(-500)
  }
  writeMissLog(log)
  const unresolved = log.filter(e => !e.resolved)
  return { total_misses: unresolved.length, recurring }
}

export function resolveMiss(query: string): void {
  const log = readMissLog()
  const entry = log.find(e => e.query.toLowerCase() === query.toLowerCase())
  if (entry) {
    entry.resolved = true
    writeMissLog(log)
  }
}

export function getMissStats(limit = 20): { unresolved: MissEntry[]; top_missed: { query: string; count: number }[] } {
  const log = readMissLog()
  const unresolved = log.filter(e => !e.resolved).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)

  const countMap: Record<string, number> = {}
  for (const e of log) {
    if (!e.resolved) {
      const key = e.query.toLowerCase()
      countMap[key] = (countMap[key] || 0) + 1
    }
  }
  const topMissed = Object.entries(countMap)
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)

  return { unresolved, top_missed: topMissed }
}
