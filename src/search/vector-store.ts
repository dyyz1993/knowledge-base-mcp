import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { embed, docToSearchableText } from "./embedding"
import type { DocMeta } from "../storage/index"

function getDir() {
  return process.env.KB_DIR || `${process.env.HOME}/.knowledge`
}

function vectorPath() {
  return `${getDir()}/vectors.json`
}

function ensureDir() {
  const dir = getDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadVectors(): Record<string, number[]> {
  try {
    return JSON.parse(readFileSync(vectorPath(), "utf-8"))
  } catch {
    return {}
  }
}

export function saveVectors(vectors: Record<string, number[]>): void {
  ensureDir()
  writeFileSync(vectorPath(), JSON.stringify(vectors, null, 2))
}

export async function indexDoc(id: string, text: string): Promise<number[]> {
  const vec = await embed(text)
  const vectors = loadVectors()
  vectors[id] = vec
  saveVectors(vectors)
  return vec
}

export async function indexAllDocs(docs: DocMeta[]): Promise<number> {
  const vectors = loadVectors()
  let indexed = 0
  for (const doc of docs) {
    if (!vectors[doc.id]) {
      vectors[doc.id] = await embed(docToSearchableText(doc))
      indexed++
    }
  }
  if (indexed > 0) saveVectors(vectors)
  return indexed
}

export function getAllEmbeddings(docs: DocMeta[]): { meta: DocMeta; embedding: number[] }[] {
  const vectors = loadVectors()
  return docs
    .filter(d => vectors[d.id])
    .map(d => ({ meta: d, embedding: vectors[d.id] }))
}
