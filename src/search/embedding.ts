import { homedir } from "node:os"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import { parseFrontmatter } from "../storage/markdown"
import type { DocMeta } from "../storage/index"

let transformersAvailable = true
let pipelineFn: any = null
let envConfigured = false

async function loadTransformers() {
  if (pipelineFn) return pipelineFn
  try {
    const mod = await import("@huggingface/transformers")
    if (!envConfigured) {
      mod.env.localModelPath = join(homedir(), ".cache/huggingface/local-models")
      mod.env.allowLocalModels = true
      envConfigured = true
    }
    pipelineFn = mod.pipeline
    return pipelineFn
  } catch {
    transformersAvailable = false
    return null
  }
}

let embedder: any = null

async function getEmbedder() {
  const pipe = await loadTransformers()
  if (!pipe) return null
  if (!embedder) {
    embedder = await pipe("feature-extraction", "Xenova/paraphrase-multilingual-MiniLM-L12-v2", {
      dtype: "fp32",
      local_files_only: true,
    })
  }
  return embedder
}

export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbedder()
  if (!pipe) throw new Error("Semantic search unavailable: @huggingface/transformers not installed")
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

function readDocBody(filePath: string): string {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const { content } = parseFrontmatter(raw)
    const lines = content.split("\n")
    return lines.length > 30 ? lines.slice(0, 30).join(" ") : content.replace(/\n/g, " ")
  } catch {
    return ""
  }
}

export function docToSearchableText(doc: DocMeta): string {
  const body = readDocBody(doc.file_path)
  return [
    doc.title,
    doc.keywords.join(" "),
    doc.intent,
    doc.project_description,
    ...(doc.tags || []),
    body,
  ].filter(Boolean).join(" ")
}

export async function semanticSearch(
  query: string,
  docs: { meta: DocMeta; embedding: number[] }[],
  topK = 10,
): Promise<(DocMeta & { score: number })[]> {
  if (!query || docs.length === 0) return []
  if (!transformersAvailable) return []
  try {
    const queryVec = await embed(query)
    const scored = docs.map(d => ({
      ...d.meta,
      score: cosineSimilarityVec(queryVec, d.embedding),
    }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  } catch {
    return []
  }
}
