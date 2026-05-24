import Fuse from "fuse.js"
import { readIndex, type DocMeta } from "../storage/index.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("search:fuzzy")

const _deps = { readIndex }

export function _setDeps(overrides: Partial<typeof _deps>) {
  Object.assign(_deps, overrides)
}

export function _resetDeps() {
  Object.assign(_deps, { readIndex })
}

interface FuzzyDoc {
  id: string
  title: string
  keywords: string[]
  tags: string[]
  intent: string
  project_description: string
}

let fuseIndex: Fuse<FuzzyDoc> | null = null
let fuseDocs: FuzzyDoc[] = []
let fuseIndexTime = 0
const FUSE_INDEX_TTL = 30_000

function buildFuzzyDocs(): FuzzyDoc[] {
  const idx = _deps.readIndex()
  if (!idx) return []
  return Object.entries(idx.documents).map(([id, doc]: [string, DocMeta]) => ({
    id,
    title: doc.title,
    keywords: doc.keywords || [],
    tags: doc.tags || [],
    intent: doc.intent || "",
    project_description: doc.project_description || "",
  }))
}

function getFuseIndex(): Fuse<FuzzyDoc> {
  const now = Date.now()
  if (!fuseIndex || now - fuseIndexTime > FUSE_INDEX_TTL) {
    fuseDocs = buildFuzzyDocs()
    fuseIndex = new Fuse(fuseDocs, {
      keys: [
        { name: "title", weight: 0.4 },
        { name: "keywords", weight: 0.25 },
        { name: "tags", weight: 0.15 },
        { name: "intent", weight: 0.1 },
        { name: "project_description", weight: 0.1 },
      ],
      threshold: 0.4,
      distance: 200,
      minMatchCharLength: 2,
      includeScore: true,
      ignoreLocation: true,
    })
    fuseIndexTime = now
    logger.debug(`Fuzzy index built: ${fuseDocs.length} docs`)
  }
  return fuseIndex
}

export function invalidateFuzzyIndex(): void {
  fuseIndex = null
  fuseIndexTime = 0
}

export interface FuzzyResult {
  id: string
  score: number
  title: string
}

export function fuzzySearch(query: string, limit: number = 10): FuzzyResult[] {
  const fuse = getFuseIndex()
  const results = fuse.search(query, { limit })

  return results.map(r => ({
    id: r.item.id,
    score: r.score !== undefined ? 1 - r.score : 0.5,
    title: r.item.title,
  }))
}
