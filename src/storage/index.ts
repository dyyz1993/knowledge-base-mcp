import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, renameSync } from "node:fs"
import { randomUUID } from "node:crypto"
import YAML from "yaml"
import { parseFrontmatter, buildFrontmatter } from "./markdown"
import { invalidateIDFCache } from "../search/tfidf"
import { docToSearchableText } from "../search/embedding"
import { invalidateFuzzyIndex } from "../search/fuzzy-search"
import { loadVectors, indexDoc, rebuildAllVectors, initDb } from "../search/vector-store"
import { loadConfig, getKbDir } from "../config"
import { createLogger } from "../utils/logger.js"
import { MAX_SEARCH_LIMIT } from "../search/constants"

export { searchDocs, searchDocsAdvanced, searchDocsSemantic, searchDocsCombined } from "./search.js"
export { recordMiss, resolveMiss, getMissStats } from "./miss-log.js"

const logger = createLogger("storage:index")
function getIndexPath(): string { return `${getKbDir()}/index.json` }

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

export function readIndex(): IndexFile {
  ensureDir(getKbDir())
  const now = Date.now()

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
    const idx: IndexFile = { version: 1, documents: {} }
    cachedIndex = idx
    cacheTimestamp = now
    atomicWriteIndex(idx)
    return idx
  }
}

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

export function writeDoc(
  meta: Omit<DocMeta, "id" | "file_path" | "created_at"> & { id?: string; file_path?: string; created_at?: number },
  content: string,
): DocMeta {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`writeDoc: content must be a non-empty string, got: ${typeof content} (${String(content).slice(0, 50)})`)
  }

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
  invalidateFuzzyIndex()

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

export function deleteDoc(id: string): boolean {
  invalidateCache()
  invalidateIDFCache()
  invalidateFuzzyIndex()
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
