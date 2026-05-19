import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, renameSync } from "node:fs"
import { parseFrontmatter, buildFrontmatter } from "./markdown"
import { tfidfSearch, buildIDF } from "../search/tfidf"
import { semanticSearch, docToSearchableText, embed } from "../search/embedding"
import { loadVectors, indexDoc, rebuildAllVectors, initDb } from "../search/vector-store"
import { loadConfig } from "../config"

const KNOWLEDGE_DIR = process.env.KB_DIR || `${process.env.HOME}/.knowledge`
const INDEX_PATH = `${KNOWLEDGE_DIR}/index.json`

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
const CACHE_TTL = 5000 // 5 seconds — stale cache threshold

function readIndex(): IndexFile {
  ensureDir(KNOWLEDGE_DIR)
  const now = Date.now()

  // Use cache if fresh (< 5s old)
  if (cachedIndex && (now - cacheTimestamp) < CACHE_TTL) return cachedIndex

  try {
    const raw = readFileSync(INDEX_PATH, "utf-8")
    const idx = JSON.parse(raw) as IndexFile
    cachedIndex = idx
    cacheTimestamp = now
    return idx
  } catch (e) {
    console.warn("[storage] readIndex: index file missing or corrupted, attempting recovery:", e instanceof Error ? e.message : String(e))
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
  const tmpPath = INDEX_PATH + ".tmp"
  writeFileSync(tmpPath, JSON.stringify(idx, null, 2))
  renameSync(tmpPath, INDEX_PATH)
}

function writeIndex(idx: IndexFile) {
  cachedIndex = idx
  cacheTimestamp = Date.now()
  atomicWriteIndex(idx)
}

/**
 * Recover index from .md files on disk when index.json is corrupted or missing.
 * Each .md file has YAML frontmatter with full metadata.
 */
function recoverIndexFromDisk(): IndexFile | null {
  try {
    const files = readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith(".md"))
    if (files.length === 0) return null

    const idx: IndexFile = { version: 1, documents: {} }
    for (const file of files) {
      try {
        const raw = readFileSync(`${KNOWLEDGE_DIR}/${file}`, "utf-8")
        const { frontmatter } = parseFrontmatterWithMeta(raw)
        if (frontmatter?.id && frontmatter?.title) {
          idx.documents[frontmatter.id] = frontmatter as DocMeta
        }
      } catch (e) {
        console.warn("[storage] recoverIndexFromDisk: skipping unreadable file:", e instanceof Error ? e.message : String(e))
      }
    }
    return idx
  } catch (e) {
    console.warn("[storage] recoverIndexFromDisk: failed to read knowledge dir:", e instanceof Error ? e.message : String(e))
    return null
  }
}

function parseFrontmatterWithMeta(raw: string): { frontmatter: Record<string, unknown> | null; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: null, content: raw }

  const fm: Record<string, unknown> = {}
  const fmText = match[1]
  let currentKey = ""
  let currentArr: unknown[] = []

  for (const line of fmText.split("\n")) {
    const kvMatch = line.match(/^(\w+):\s*["']?(.+?)["']?\s*$/)
    if (kvMatch) {
      if (currentKey && currentArr.length > 0) {
        fm[currentKey] = currentArr
        currentArr = []
      }
      currentKey = kvMatch[1]
      fm[currentKey] = kvMatch[2]
    } else if (line.match(/^\s+-\s+(.+)/)) {
      const val = line.match(/^\s+-\s+(.+)/)![1].replace(/^["']|["']$/g, "")
      currentArr.push(val)
    }
  }
  if (currentKey && currentArr.length > 0) {
    fm[currentKey] = currentArr
  }

  return { frontmatter: fm, content: match[2] }
}

export function generateId(): string {
  return Math.random().toString(36).slice(2).padEnd(10, "0").slice(0, 10)
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

function docFilePath(id: string, title: string) {
  return `${KNOWLEDGE_DIR}/${id}-${slugify(title)}.md`
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

  ensureDir(KNOWLEDGE_DIR)
  const md = buildFrontmatter(doc) + "\n" + content
  writeFileSync(file_path, md)

  idx.documents[id] = doc
  writeIndex(idx)
  updateOutline(doc.source_project || "", idx)

  indexDoc(id, docToSearchableText(doc)).catch(e => {
    console.warn("[storage] writeDoc: async vector indexing failed:", e instanceof Error ? e.message : String(e))
  })

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
  const limit = 50
  if (lines.length > limit) {
    return { meta, content: lines.slice(0, limit).join("\n"), truncated: true }
  }
  return { meta, content, truncated: false }
}

function extractSnippet(content: string, q: string, radius = 120): string {
  const lower = content.toLowerCase()
  const tokens = q.split(/[\s\-_]+/).filter(Boolean)
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
    console.warn("[storage] readDocContent: failed to read file:", filePath, e instanceof Error ? e.message : String(e))
    return ""
  }
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

function contentQualityBoost(filePath: string): number {
  let boost = 0
  try {
    const body = readDocContent(filePath)
    if (!body) return 0

    const codeBlockPairs = ((body.match(/```/g) || []).length) / 2
    boost += Math.min(codeBlockPairs, 3) * 3

    const len = body.length
    if (len >= 3000) boost += 5
    else if (len >= 2000) boost += 4
    else if (len >= 500) boost += 2
  } catch (e) {
    console.warn("[storage] contentQualityBoost: failed to read file for boost:", e instanceof Error ? e.message : String(e))
  }
  return boost
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
      const tokens = q.split(/[\s\-_]+/).filter(Boolean)
      for (const token of tokens) {
        if (tokenMatch(doc.title, token)) { score += 10; if (!matched_by.includes("title")) matched_by.push("title") }
        if (doc.keywords.some(k => tokenMatch(k, token))) { score += 4; if (!matched_by.includes("keywords")) matched_by.push("keywords") }
        if (tokenMatch(doc.intent, token)) { score += 5; if (!matched_by.includes("intent")) matched_by.push("intent") }
        if (tokenMatch(doc.project_description, token)) { score += 1; if (!matched_by.includes("project_description")) matched_by.push("project_description") }
        if (body.includes(token)) { score += 2; if (!matched_by.includes("content")) matched_by.push("content") }
      }
      if (tokens.length > 1) {
        if (tokenMatch(doc.title, q)) score += 5
        if (doc.keywords.some(k => k.toLowerCase().includes(q))) score += 3
        if (tokenMatch(doc.intent, q)) score += 2
        if (tokenMatch(doc.project_description, q)) score += 1
        if (body.includes(q)) score += 3
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
      score += contentQualityBoost(doc.file_path)
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

  const vectors = loadVectors()
  const missing = docs.filter(d => !vectors[d.id])
  if (missing.length > 0) {
    for (const doc of missing) {
      await indexDoc(doc.id, docToSearchableText(doc))
    }
  }

  const allVectors = loadVectors()
  const docsVecs = docs
    .filter(d => allVectors[d.id])
    .map(d => ({ meta: d, embedding: allVectors[d.id] }))

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
    return searchDocsSemantic(query, limit)
  }

  const p0Results = searchDocs(query, keywords, tags, limit * 2)

  const idx = readIndex()
  const allDocs = Object.values(idx.documents)
  const idf = buildIDF(allDocs)
  const p1Results = tfidfSearch(query, allDocs, idf, limit * 2)

  let p2Results: (DocMeta & { score: number })[] = []
  try {
    p2Results = await searchDocsSemantic(query, limit * 2)
  } catch (e) {
    console.warn("[storage] searchDocsCombined: semantic search failed, skipping:", e instanceof Error ? e.message : String(e))
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
    const max = Math.max(...results.map(r => r.score))
    if (max <= 0) return results
    return results.map(r => ({ ...r, score: r.score / max }))
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

export function getOutline(project: string) {
  const slug = slugify(project)
  const path = `${KNOWLEDGE_DIR}/outlines/${slug}.json`
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, "utf-8"))
}

export function updateOutline(project: string, idx?: IndexFile) {
  if (!project) return
  if (!idx) idx = readIndex()
  const slug = slugify(project)
  const dir = `${KNOWLEDGE_DIR}/outlines`
  ensureDir(dir)

  const docs = Object.values(idx.documents)
    .filter(d => d.source_project === project)
    .sort((a, b) => b.created_at - a.created_at)
    .map(d => ({ id: d.id, title: d.title, tags: d.tags, keywords: d.keywords, intent: d.intent }))

  const outline = { project, updated_at: Date.now(), docs }
  writeFileSync(`${dir}/${slug}.json`, JSON.stringify(outline, null, 2))
}

export function listAllOutlines(): { project: string; name: string; doc_count: number; updated_at: number }[] {
  const dir = `${KNOWLEDGE_DIR}/outlines`
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
        console.warn("[storage] listAllOutlines: skipping unreadable outline file:", e instanceof Error ? e.message : String(e))
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

const MISS_LOG_PATH = `${KNOWLEDGE_DIR}/miss-log.json`

interface MissEntry {
  query: string
  timestamp: number
  resolved: boolean
}

function readMissLog(): MissEntry[] {
  try {
    if (!existsSync(MISS_LOG_PATH)) return []
    return JSON.parse(readFileSync(MISS_LOG_PATH, "utf-8"))
  } catch (e) {
    console.warn("[storage] readMissLog: failed to read miss log:", e instanceof Error ? e.message : String(e))
    return []
  }
}

function writeMissLog(log: MissEntry[]) {
  ensureDir(KNOWLEDGE_DIR)
  writeFileSync(MISS_LOG_PATH, JSON.stringify(log, null, 2))
}

export function recordMiss(query: string): { total_misses: number; recurring: boolean } {
  const log = readMissLog()
  const existing = log.find(e => e.query.toLowerCase() === query.toLowerCase())
  const recurring = !!existing
  if (existing) {
    existing.timestamp = Date.now()
  } else {
    log.push({ query, timestamp: Date.now(), resolved: false })
  }
  writeMissLog(log)
  const unresolved = log.filter(e => !e.resolved)
  return { total_misses: unresolved.length, recurring }
}

export function resolveMiss(query: string) {
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
