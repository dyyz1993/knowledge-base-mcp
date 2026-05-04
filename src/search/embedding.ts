import { pipeline, env, type Pipeline } from "@huggingface/transformers"
import { homedir } from "node:os"
import { join } from "node:path"
import type { DocMeta } from "../storage/index"

env.localModelPath = join(homedir(), ".cache/huggingface/local-models")
env.allowLocalModels = true

let embedder: Pipeline | null = null

async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L12-v2", {
      dtype: "fp32",
      local_files_only: true,
    })
  }
  return embedder
}

export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbedder()
  const output = await pipe(text, { pooling: "mean", normalize: true })
  return Array.from(output.data) as number[]
}

export function cosineSimilarityVec(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8)
}

export function docToSearchableText(doc: DocMeta): string {
  return [
    doc.title,
    doc.keywords.join(" "),
    doc.intent,
    doc.project_description,
    ...(doc.tags || []),
  ].filter(Boolean).join(" ")
}

export async function semanticSearch(
  query: string,
  docs: { meta: DocMeta; embedding: number[] }[],
  topK = 10,
): Promise<(DocMeta & { score: number })[]> {
  if (!query || docs.length === 0) return []
  const queryVec = await embed(query)
  const scored = docs.map(d => ({
    ...d.meta,
    score: cosineSimilarityVec(queryVec, d.embedding),
  }))
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}
