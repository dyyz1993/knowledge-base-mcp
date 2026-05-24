import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync, readFileSync, mkdirSync, statSync } from "node:fs"
import { embed, embedBatch, docToSearchableText } from "./embedding"
import type { DocMeta } from "../storage/index"
import { createLogger } from "../utils/logger.js"
import { getKbDir } from "../config"


const logger = createLogger("search:vector-store")
function getDir() {
  return getKbDir()
}

function dbPath() {
  return join(getDir(), "embeddings.db")
}

function jsonPath() {
  return join(getDir(), "vectors.json")
}

let db: Database | null = null

function getDb(): Database {
  if (!db) {
    const dir = getDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    db = new Database(dbPath())
    db.exec("PRAGMA journal_mode=WAL")
    db.exec(`CREATE TABLE IF NOT EXISTS embeddings (
      doc_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      dimensions INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`)
    migrateFromJson()
  }
  return db
}

function encodeVector(vec: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(vec).buffer)
}

function decodeVector(blob: Uint8Array): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4)
}

function migrateFromJson(): void {
  const d = db!
  const count = d.query("SELECT COUNT(*) as c FROM embeddings").get() as { c: number } | null
  if (count && count.c > 0) return
  if (!existsSync(jsonPath())) return

  try {
    const raw = JSON.parse(readFileSync(jsonPath(), "utf-8"))
    const entries = Object.entries(raw) as [string, number[]][]
    if (entries.length === 0) return

    const stmt = d.prepare(
      "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, 'migrated', ?, ?)",
    )
    const insertMany = d.transaction((items: [string, number[]][]) => {
      for (const [id, vec] of items) {
        stmt.run(id, encodeVector(vec), vec.length, Date.now())
      }
    })
    insertMany(entries)
    logger.debug(`Migrated ${entries.length} vectors from vectors.json to SQLite`)
  } catch (e) {
    logger.error("Migration failed:", e)
  }
}

export function initDb(): void {
  getDb()
}

export function loadVectors(): Record<string, number[]> {
  const d = getDb()
  const rows = d.query("SELECT doc_id, embedding FROM embeddings").all() as { doc_id: string; embedding: Uint8Array }[]
  const result: Record<string, number[]> = {}
  for (const row of rows) {
    result[row.doc_id] = Array.from(decodeVector(row.embedding))
  }
  return result
}

export function saveVectors(vectors: Record<string, number[]>): void {
  const d = getDb()
  const stmt = d.prepare(
    "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, 'saveVectors', ?, ?)",
  )
  const entries = Object.entries(vectors)
  const insertMany = d.transaction((items: [string, number[]][]) => {
    for (const [id, vec] of items) {
      stmt.run(id, encodeVector(vec), vec.length, Date.now())
    }
  })
  insertMany(entries)
}

export async function indexDoc(id: string, text: string): Promise<number[]> {
  const vec = await embed(text)
  const d = getDb()
  const { loadConfig } = await import("../config")
  const config = loadConfig()
  const model = config.embedding.model || "local"
  const stmt = d.prepare(
    "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, ?, ?, ?)",
  )
  const tx = d.transaction(() => {
    stmt.run(id, encodeVector(vec), model, vec.length, Date.now())
  })
  tx()
  return vec
}

export async function indexAllDocs(docs: DocMeta[]): Promise<number> {
  const d = getDb()
  const { loadConfig } = await import("../config")
  const config = loadConfig()

  const newDocs = docs.filter(doc => {
    const existing = d.query("SELECT doc_id FROM embeddings WHERE doc_id = ?").get(doc.id)
    return !existing
  })

  if (newDocs.length === 0) return 0

  const BATCH_SIZE = 32
  let indexed = 0

  for (let i = 0; i < newDocs.length; i += BATCH_SIZE) {
    const batch = newDocs.slice(i, i + BATCH_SIZE)
    const texts = batch.map(doc => docToSearchableText(doc))
    const vectors = await embedBatch(texts)

    const stmt = d.prepare(
      "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    const insertMany = d.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        stmt.run(batch[j].id, encodeVector(vectors[j]), config.embedding.model, vectors[j].length, Date.now())
      }
    })
    insertMany()
    indexed += batch.length
  }

  return indexed
}

export function getAllEmbeddings(docs: DocMeta[]): { meta: DocMeta; embedding: number[] }[] {
  const vectors = loadVectors()
  return docs
    .filter(d => vectors[d.id])
    .map(d => ({ meta: d, embedding: vectors[d.id] }))
}

export async function rebuildAllVectors(docs: DocMeta[]): Promise<number> {
  const d = getDb()
  const { loadConfig } = await import("../config")
  const config = loadConfig()

  d.exec("DELETE FROM embeddings")

  const BATCH_SIZE = 32
  let count = 0

  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = docs.slice(i, i + BATCH_SIZE)
    const texts = batch.map(doc => docToSearchableText(doc))
    const vectors = await embedBatch(texts)

    const stmt = d.prepare(
      "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    const insertMany = d.transaction(() => {
      for (let j = 0; j < batch.length; j++) {
        stmt.run(batch[j].id, encodeVector(vectors[j]), config.embedding.model, vectors[j].length, Date.now())
        count++
      }
    })
    insertMany()
  }

  return count
}

export function getVectorCount(): number {
  const d = getDb()
  const row = d.query("SELECT COUNT(*) as c FROM embeddings").get() as { c: number } | null
  return row?.c ?? 0
}

export function getStorageStats(): { count: number; dbSize: number; model: string; dimensions: number } {
  const d = getDb()
  const row = d.query("SELECT COUNT(*) as c FROM embeddings").get() as { c: number } | null
  const modelRow = d.query("SELECT model, dimensions FROM embeddings LIMIT 1").get() as { model: string; dimensions: number } | null
  let dbSize = 0
  try {
    dbSize = statSync(dbPath()).size
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
  return {
    count: row?.c ?? 0,
    dbSize,
    model: modelRow?.model || "",
    dimensions: modelRow?.dimensions || 0,
  }
}

let lastMismatchLog = 0

export function checkAndUpdateModel(currentModel: string, currentDims: number): boolean {
  const d = getDb()
  const row = d.query("SELECT model, dimensions FROM embeddings LIMIT 1").get() as { model: string; dimensions: number } | null
  if (!row) return false

  const modelChanged = row.model && row.model !== currentModel && row.model !== "migrated" && row.model !== "saveVectors"
  const dimsChanged = row.dimensions > 0 && row.dimensions !== currentDims

  if (modelChanged || dimsChanged) {
    const now = Date.now()
    if (now - lastMismatchLog > 60000) {
      logger.warn(
        `Embedding model mismatch: stored(model=${row.model}, dims=${row.dimensions}) vs config(model=${currentModel}, dims=${currentDims}). Use POST /api/embedding/reindex to rebuild.`,
      )
      lastMismatchLog = now
    }
  }
  return false
}

export function resetDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function closeDb(): void {
  if (db) {
    try { db.close() } catch { /* already closed */ }
    db = null
  }
}
