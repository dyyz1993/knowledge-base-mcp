import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs"
import { parseFrontmatter, buildFrontmatter } from "./markdown"
import { tfidfSearch, buildIDF } from "../search/tfidf"
import { semanticSearch, docToSearchableText, embed } from "../search/embedding"
import { loadVectors, saveVectors } from "../search/vector-store"

const KNOWLEDGE_DIR = process.env.KB_DIR || `${process.env.HOME}/.knowledge`
const INDEX_PATH = `${KNOWLEDGE_DIR}/index.json`

export interface DocMeta {
  id: string
  title: string
  tags: string[]
  keywords: string[]
  intent: string
  project_description: string
  source_project: string
  source_worktree: string
  related_projects?: string[]
  created_at: number
  file_path: string
}

export interface IndexFile {
  version: number
  documents: Record<string, DocMeta>
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readIndex(): IndexFile {
  ensureDir(KNOWLEDGE_DIR)
  try {
    const raw = readFileSync(INDEX_PATH, "utf-8")
    return JSON.parse(raw) as IndexFile
  } catch {
    const idx: IndexFile = { version: 1, documents: {} }
    writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2))
    return idx
  }
}

function writeIndex(idx: IndexFile) {
  writeFileSync(INDEX_PATH, JSON.stringify(idx, null, 2))
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 12)
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

function docFilePath(id: string, title: string) {
  return `${KNOWLEDGE_DIR}/${id}-${slugify(title)}.md`
}

export function findDuplicate(meta: { title: string; source_project: string }, idx: IndexFile): DocMeta | null {
  return Object.values(idx.documents).find(
    d => d.title === meta.title && d.source_project === (meta.source_project || "")
  ) || null
}

export function writeDoc(
  meta: Omit<DocMeta, "id" | "file_path" | "created_at"> & { id?: string; file_path?: string; created_at?: number },
  content: string,
): DocMeta {
  const idx = readIndex()
  const existing = !meta.id ? findDuplicate(meta, idx) : null
  const id = meta.id || existing?.id || generateId()
  const created_at = meta.created_at || existing?.created_at || Date.now()
  const file_path = meta.file_path || existing?.file_path || docFilePath(id, meta.title)

  if (existing) {
    if (existsSync(existing.file_path) && existing.file_path !== file_path) {
      unlinkSync(existing.file_path)
    }
  }

  const doc: DocMeta = { ...meta, id, created_at, file_path } as DocMeta

  const md = buildFrontmatter(doc) + "\n" + content
  writeFileSync(file_path, md)

  idx.documents[id] = doc
  writeIndex(idx)
  updateOutline(doc.source_project, idx)
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
  } catch {
    return ""
  }
}

export function searchDocs(
  query?: string,
  keywords?: string[],
  tags?: string[],
  limit = 10,
): (DocMeta & { score: number; snippet?: string })[] {
  const idx = readIndex()
  const q = (query || "").toLowerCase()
  const results: (DocMeta & { score: number; snippet?: string })[] = []

  for (const doc of Object.values(idx.documents)) {
    let score = 0
    let snippet = ""
    const body = readDocContent(doc.file_path).toLowerCase()

    if (q) {
      const tokens = q.split(/[\s\-_]+/).filter(Boolean)
      for (const token of tokens) {
        if (doc.title.toLowerCase().includes(token)) score += 10
        if (doc.keywords.some(k => k.toLowerCase().includes(token))) score += 4
        if (doc.intent.toLowerCase().includes(token)) score += 5
        if (doc.project_description.toLowerCase().includes(token)) score += 3
        if (body.includes(token)) score += 2
      }
      if (tokens.length > 1) {
        if (doc.title.toLowerCase().includes(q)) score += 5
        if (doc.keywords.some(k => k.toLowerCase().includes(q))) score += 3
        if (doc.intent.toLowerCase().includes(q)) score += 2
        if (doc.project_description.toLowerCase().includes(q)) score += 1
        if (body.includes(q)) score += 3
      }
      if (body && tokens.some(t => body.includes(t))) {
        snippet = extractSnippet(readDocContent(doc.file_path), q)
      }
    }
    if (tags?.length) {
      if (doc.tags.some(t => tags.includes(t))) score += 5
    }
    if (keywords?.length) {
      if (doc.keywords.some(k => keywords.some(kw => k.toLowerCase().includes(kw.toLowerCase())))) score += 3
    }
    if (score > 0) results.push({ ...doc, score, snippet })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit)
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
      vectors[doc.id] = await embed(docToSearchableText(doc))
    }
    saveVectors(vectors)
  }

  const docsVecs = docs
    .filter(d => vectors[d.id])
    .map(d => ({ meta: d, embedding: vectors[d.id] }))

  return semanticSearch(query, docsVecs, limit)
}

export async function searchDocsCombined(
  query: string,
  keywords?: string[],
  tags?: string[],
  limit = 10,
): Promise<(DocMeta & { score: number })[]> {
  const p0Results = searchDocs(query, keywords, tags, limit * 2)

  const idx = readIndex()
  const allDocs = Object.values(idx.documents)
  const idf = buildIDF(allDocs)
  const p1Results = tfidfSearch(query, allDocs, idf, limit * 2)

  let p2Results: (DocMeta & { score: number })[] = []
  try {
    p2Results = await searchDocsSemantic(query, limit * 2)
  } catch {
    // fallback to P0+P1 if embedding fails
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

  const maxP0 = Math.max(...p0Results.map(r => r.score), 1)
  addScores(p0Results.map(r => ({ ...r, score: r.score / maxP0 })), 0.2)
  addScores(p1Results, 0.3)
  addScores(p2Results, 0.5)

  return Array.from(combined.values())
    .sort((a, b) => b.score - a.score)
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

export function deleteDoc(id: string): boolean {
  const idx = readIndex()
  const doc = idx.documents[id]
  if (!doc) return false

  if (existsSync(doc.file_path)) unlinkSync(doc.file_path)

  const project = doc.source_project
  delete idx.documents[id]
  writeIndex(idx)
  updateOutline(project, idx)
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
    .map(d => ({ id: d.id, title: d.title, tags: d.tags, keywords: d.keywords }))

  const outline = { project, updated_at: Date.now(), docs }
  writeFileSync(`${dir}/${slug}.json`, JSON.stringify(outline, null, 2))
}
