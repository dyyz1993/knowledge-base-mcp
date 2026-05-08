import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync, readFileSync, mkdirSync, statSync } from "node:fs"
import { embed, docToSearchableText } from "./embedding"
import type { DocMeta } from "../storage/index"

function getDir() {
  return process.env.KB_DIR || `${process.env.HOME}/.knowledge`
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
  const count = d.query("SELECT COUNT(*) as c FROM embeddings").get() as any
  if (count.c > 0) return
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
    console.log(`Migrated ${entries.length} vectors from vectors.json to SQLite`)
  } catch (e) {
    console.error("Migration failed:", e)
  }
}

export function initDb(): void {
  getDb()
}

export function loadVectors(): Record<string, number[]> {
  const d = getDb()
  const rows = d.query("SELECT doc_id, embedding FROM embeddings").all() as any[]
  const result: Record<string, number[]> = {}
  for (const row of rows) {
    result[row.doc_id] = Array.from(decodeVector(row.embedding))
  }
  return result
}

export function saveVectors(vectors: Record<string, number[]>): void {
  const d = getDb()
  const stmt = d.prepare(
    "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, '', ?, ?)",
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
  d.prepare(
    "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, '', ?, ?)",
  ).run(id, encodeVector(vec), vec.length, Date.now())
  return vec
}

export async function indexAllDocs(docs: DocMeta[]): Promise<number> {
  const d = getDb()
  let indexed = 0
  const { loadConfig } = await import("../config")
  const config = loadConfig()

  const stmt = d.prepare(
    "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, ?, ?, ?)",
  )

  for (const doc of docs) {
    const existing = d.query("SELECT doc_id FROM embeddings WHERE doc_id = ?").get(doc.id)
    if (existing) continue
    const vec = await embed(docToSearchableText(doc))
    stmt.run(doc.id, encodeVector(vec), config.embedding.model, vec.length, Date.now())
    indexed++
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

  const stmt = d.prepare(
    "INSERT OR REPLACE INTO embeddings (doc_id, embedding, model, dimensions, updated_at) VALUES (?, ?, ?, ?, ?)",
  )

  for (const doc of docs) {
    const vec = await embed(docToSearchableText(doc))
    stmt.run(doc.id, encodeVector(vec), config.embedding.model, vec.length, Date.now())
  }
  return docs.length
}

export function getVectorCount(): number {
  const d = getDb()
  const row = d.query("SELECT COUNT(*) as c FROM embeddings").get() as any
  return row.c
}

export function getStorageStats(): { count: number; dbSize: number; model: string; dimensions: number } {
  const d = getDb()
  const row = d.query("SELECT COUNT(*) as c FROM embeddings").get() as any
  const modelRow = d.query("SELECT model, dimensions FROM embeddings LIMIT 1").get() as any
  let dbSize = 0
  try {
    dbSize = statSync(dbPath()).size
  } catch {}
  return {
    count: row.c,
    dbSize,
    model: modelRow?.model || "",
    dimensions: modelRow?.dimensions || 0,
  }
}

export function resetDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
