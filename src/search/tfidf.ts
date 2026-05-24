import { readFileSync } from "node:fs"
import { parseFrontmatter } from "../storage/markdown"
import type { DocMeta } from "../storage/index"
import { tokenize } from "../utils/tokenizer"
import { recordCacheHit, recordCacheMiss } from "./perf-metrics.js"

function readDocBody(filePath: string): string {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const { content } = parseFrontmatter(raw)
    return content
  } catch {
    return ""
  }
}

function tokenizeBigram(text: string): string[] {
  return tokenize(text, { bigram: true })
}

export function buildTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>()
  for (const t of tokens) {
    tf.set(t, (tf.get(t) || 0) + 1)
  }
  return tf
}

function buildWeightedTF(doc: DocMeta): Map<string, number> {
  const combined = new Map<string, number>()
  const fields: [string, number][] = [
    [doc.title, 3],
    [doc.keywords.join(" "), 2],
    [doc.intent, 1.5],
    [doc.project_description, 1],
    [readDocBody(doc.file_path), 0.8],
  ]
  for (const [text, weight] of fields) {
    const tf = buildTF(tokenizeBigram(text))
    for (const [token, freq] of tf) {
      combined.set(token, (combined.get(token) || 0) + freq * weight)
    }
  }
  return combined
}

let idfCache: Map<string, number> | null = null
let idfCacheDocCount = 0
let idfCacheTime = 0
const IDF_CACHE_TTL = 30000

export function getIDF(docs: DocMeta[]): Map<string, number> {
  if (idfCache && Date.now() - idfCacheTime < IDF_CACHE_TTL && idfCacheDocCount === docs.length) {
    return idfCache
  }
  const idf = buildIDFUncached(docs)
  idfCache = idf
  idfCacheDocCount = docs.length
  idfCacheTime = Date.now()
  return idf
}

export function invalidateIDFCache(): void {
  idfCache = null
  idfCacheDocCount = 0
  tfVectorCache.clear()
}

const tfVectorCache = new Map<string, { time: number; vec: Map<string, number> }>()
const TF_CACHE_TTL = 60000
const MAX_TF_CACHE = 500

function evictTfCache() {
  if (tfVectorCache.size < MAX_TF_CACHE) return
  const keys = [...tfVectorCache.keys()].slice(0, 100)
  for (const k of keys) tfVectorCache.delete(k)
}

function getCachedWeightedTF(doc: DocMeta): Map<string, number> {
  const cached = tfVectorCache.get(doc.id)
  if (cached && Date.now() - cached.time < TF_CACHE_TTL) {
    recordCacheHit("tf")
    return cached.vec
  }
  recordCacheMiss("tf")
  evictTfCache()
  const vec = buildWeightedTF(doc)
  tfVectorCache.set(doc.id, { time: Date.now(), vec })
  return vec
}

function buildIDFUncached(docs: DocMeta[]): Map<string, number> {
  const N = docs.length
  const df = new Map<string, number>()
  for (const doc of docs) {
    const tf = getCachedWeightedTF(doc)
    for (const token of tf.keys()) {
      df.set(token, (df.get(token) || 0) + 1)
    }
  }
  const idf = new Map<string, number>()
  for (const [token, count] of df) {
    idf.set(token, Math.max(0, Math.log((1 + N) / (1 + count))))
  }
  return idf
}

export function buildIDF(docs: DocMeta[]): Map<string, number> {
  return getIDF(docs)
}

export function cosineSimilarity(
  a: Map<string, number>,
  b: Map<string, number>,
): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (const [k, v] of a) {
    if (b.has(k)) dot += v * b.get(k)!
    normA += v * v
  }
  for (const v of b.values()) {
    normB += v * v
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export function tfidfSearch(
  query: string,
  docs: DocMeta[],
  idf: Map<string, number>,
  topK = 10,
): (DocMeta & { score: number })[] {
  if (!query || docs.length === 0) return []

  const queryTokens = tokenizeBigram(query)
  if (queryTokens.length === 0) return []

  const N = docs.length
  const queryTF = buildTF(queryTokens)
  const queryVec = new Map<string, number>()
  for (const [t, freq] of queryTF) {
    const idfVal = idf.has(t) ? idf.get(t)! : Math.log(N)
    queryVec.set(t, freq * idfVal)
  }

  const results: (DocMeta & { score: number })[] = []
  for (const doc of docs) {
    const docTF = getCachedWeightedTF(doc)
    const docVec = new Map<string, number>()
    for (const [t, freq] of docTF) {
      docVec.set(t, freq * (idf.get(t) || 0))
    }
    const sim = cosineSimilarity(queryVec, docVec)
    if (sim > 0) results.push({ ...doc, score: sim })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK)
}
