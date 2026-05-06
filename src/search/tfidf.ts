import { readFileSync } from "node:fs"
import { parseFrontmatter } from "../storage/markdown"
import type { DocMeta } from "../storage/index"

const FIELD_WEIGHTS: [string, number][] = [
  ["title", 3],
  ["keywords", 2],
  ["intent", 1.5],
  ["project_description", 1],
]

function readDocBody(filePath: string): string {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const { content } = parseFrontmatter(raw)
    return content
  } catch {
    return ""
  }
}

export function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()

  const segments = lower.match(/[\u4e00-\u9fff]+/g) || []
  for (const seg of segments) {
    for (let i = 0; i < seg.length - 1; i++) {
      tokens.push(seg[i] + seg[i + 1])
    }
  }

  const words = lower.match(/[a-z0-9]+/g) || []
  tokens.push(...words)

  return tokens
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
    const tf = buildTF(tokenize(text))
    for (const [token, freq] of tf) {
      combined.set(token, (combined.get(token) || 0) + freq * weight)
    }
  }
  return combined
}

export function buildIDF(docs: DocMeta[]): Map<string, number> {
  const N = docs.length
  const df = new Map<string, number>()
  for (const doc of docs) {
    const tf = buildWeightedTF(doc)
    for (const token of tf.keys()) {
      df.set(token, (df.get(token) || 0) + 1)
    }
  }
  const idf = new Map<string, number>()
  for (const [token, count] of df) {
    idf.set(token, Math.log(N / (1 + count)))
  }
  return idf
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

  const queryTokens = tokenize(query)
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
    const docTF = buildWeightedTF(doc)
    const docVec = new Map<string, number>()
    for (const [t, freq] of docTF) {
      docVec.set(t, freq * (idf.get(t) || 0))
    }
    const sim = cosineSimilarity(queryVec, docVec)
    if (sim > 0) results.push({ ...doc, score: sim })
  }

  return results.sort((a, b) => b.score - a.score).slice(0, topK)
}
