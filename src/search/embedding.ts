import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { parseFrontmatter } from "../storage/markdown"
import type { DocMeta } from "../storage/index"
import { loadConfig } from "../config"
import { embeddingStats } from "../statistics"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("search:embedding")
let transformersAvailable = true
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically loaded @huggingface/transformers pipeline; types are not available at compile time
type PipelineFn = (...args: any[]) => Promise<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- embedder returned by pipeline(); opaque runtime object
type EmbedderType = (input: string | string[], options: Record<string, unknown>) => Promise<{ data: Float32Array; [key: string]: unknown }>

let pipelineFn: PipelineFn | null = null
let envConfigured = false

const embeddingCache = new Map<string, number[]>()
const MAX_CACHE_SIZE = 500

function getCacheKey(text: string): string {
  return `${text.length}:${text}`
}

function cacheGet(text: string): number[] | undefined {
  return embeddingCache.get(getCacheKey(text))
}

function cacheSet(text: string, embedding: number[]): void {
  const key = getCacheKey(text)
  if (embeddingCache.has(key)) {
    embeddingCache.delete(key)
    embeddingCache.set(key, embedding)
    return
  }
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    const firstKey = embeddingCache.keys().next().value
    if (firstKey !== undefined) embeddingCache.delete(firstKey)
  }
  embeddingCache.set(key, embedding)
}

export function clearEmbeddingCache(): void {
  embeddingCache.clear()
}

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

const MODEL_ID = "Xenova/paraphrase-multilingual-MiniLM-L12-v2"
const MODEL_DIR = join(homedir(), ".cache/huggingface/local-models", MODEL_ID)
const MIRROR_BASE = `https://hf-mirror.com/${MODEL_ID}/resolve/main`

const MODEL_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
]

async function ensureLocalModel(): Promise<void> {
  const onnxPath = join(MODEL_DIR, "onnx", "model_quantized.onnx")
  if (existsSync(onnxPath)) return

  const autoDownload = loadConfig().embedding.autoDownload !== false
  if (!autoDownload) {
    throw new Error(
      `Local embedding model not found at ${onnxPath}. ` +
      `Set embedding.autoDownload to true or download manually from hf-mirror.com.`,
    )
  }

  logger.info("Local embedding model not found, downloading from hf-mirror.com...")
  mkdirSync(join(MODEL_DIR, "onnx"), { recursive: true })

  for (const file of MODEL_FILES) {
    const url = `${MIRROR_BASE}/${file}`
    const dest = join(MODEL_DIR, file)
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`Failed to download ${file}: ${resp.status}`)
    writeFileSync(dest, await resp.text())
    logger.debug(`Downloaded ${file}`)
  }

  const modelUrl = `${MIRROR_BASE}/onnx/model_quantized.onnx`
  logger.info("Downloading model_quantized.onnx (~113MB)...")
  const modelResp = await fetch(modelUrl)
  if (!modelResp.ok) throw new Error(`Failed to download model: ${modelResp.status}`)
  const buffer = Buffer.from(await modelResp.arrayBuffer())
  writeFileSync(onnxPath, buffer)
  logger.info(`Model downloaded: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`)
}

let embedder: EmbedderType | null = null

async function embedLocal(text: string): Promise<number[]> {
  const pipe = await loadTransformers()
  if (!pipe) throw new Error("Semantic search unavailable: @huggingface/transformers not installed")
  if (!embedder) {
    await ensureLocalModel()
    embedder = (await pipe("feature-extraction", MODEL_ID, {
      dtype: "fp32",
      local_files_only: true,
    })) as unknown as EmbedderType
  }
  const output = await embedder(text, { pooling: "mean", normalize: true })
  const vec = Array.from(output.data) as number[]
  logger.debug(`embedLocal: generated embedding with ${vec.length} dimensions`)
  return vec
}

const MAX_EMBEDDING_CHARS = 8000

function truncateForEmbedding(text: string): string {
  if (text.length <= MAX_EMBEDDING_CHARS) return text
  return text.slice(0, MAX_EMBEDDING_CHARS)
}

async function embedExternal(text: string): Promise<number[]> {
  const config = loadConfig()
  const url = `${config.embedding.baseUrl}/embeddings`

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.embedding.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.embedding.model,
      input: truncateForEmbedding(text),
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Embedding API error: ${resp.status} ${err}`)
  }

  const data = await resp.json()
  return data.data[0].embedding
}

export async function embed(text: string): Promise<number[]> {
  const cached = cacheGet(text)
  if (cached) return cached

  const config = loadConfig()
  const t0 = Date.now()
  let result: number[]

  if (config.embedding.enabled && config.embedding.apiKey) {
    try {
      result = await embedExternal(text)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : (typeof e === "string" ? e : JSON.stringify(e))
      logger.error("External embedding failed, falling back to local:", errMsg)
      result = await embedLocal(text)
    }
  } else {
    result = await embedLocal(text)
  }

  const ms = Date.now() - t0
  const tokens = text.length
  embeddingStats.recordCall(tokens, ms)

  cacheSet(text, result)
  return result
}

async function embedBatchExternal(texts: string[]): Promise<number[][]> {
  const config = loadConfig()
  const url = `${config.embedding.baseUrl}/embeddings`

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.embedding.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.embedding.model,
      input: texts.map(truncateForEmbedding),
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Embedding API error: ${resp.status} ${err}`)
  }

  const data = await resp.json() as { data: { index: number; embedding: number[] }[] }
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding)
}

async function embedBatchLocal(texts: string[]): Promise<number[][]> {
  if (!transformersAvailable) {
    throw new Error("Semantic search unavailable: @huggingface/transformers not installed")
  }

  const pipe = await loadTransformers()
  if (!pipe) throw new Error("Semantic search unavailable: @huggingface/transformers not installed")

  if (!embedder) {
    await ensureLocalModel()
    embedder = (await pipe("feature-extraction", MODEL_ID, {
      dtype: "fp32",
      local_files_only: true,
    })) as unknown as EmbedderType
  }

  const BATCH_SIZE = 32
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const outputs = await embedder(batch, { pooling: "mean", normalize: true })
    for (let j = 0; j < batch.length; j++) {
      const row = (outputs as unknown as Record<number, { data: Float32Array }>)[j]
      results.push(Array.from(row.data) as number[])
    }
  }

  return results
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []

  const results: number[][] = new Array(texts.length)
  const toCompute: { index: number; text: string }[] = []

  for (let i = 0; i < texts.length; i++) {
    const cached = cacheGet(texts[i])
    if (cached) {
      results[i] = cached
    } else {
      toCompute.push({ index: i, text: texts[i] })
    }
  }

  if (toCompute.length === 0) return results

  const computeTexts = toCompute.map(t => t.text)
  let computed: number[][]

  const config = loadConfig()
  if (config.embedding.enabled && config.embedding.apiKey) {
    try {
      computed = await embedBatchExternal(computeTexts)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : (typeof e === "string" ? e : JSON.stringify(e))
      logger.error("External batch embedding failed, falling back to local:", errMsg)
      computed = await embedBatchLocal(computeTexts)
    }
  } else {
    computed = await embedBatchLocal(computeTexts)
  }

  for (let i = 0; i < toCompute.length; i++) {
    const { index, text } = toCompute[i]
    results[index] = computed[i]
    cacheSet(text, computed[i])
  }

  return results
}

export function cosineSimilarityVec(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    logger.warn(`cosineSimilarityVec: dimension mismatch (${a.length} vs ${b.length}), returning 0`)
    return 0
  }
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
  const config = loadConfig()
  if (!transformersAvailable && !config.embedding?.enabled) return []
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
