import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import { getKbDir } from "../config"
import type { ResearchResult, ResearchProgress } from "./types.js"

export interface ResearchState {
  researchId: string
  query: string
  mode: string
  status: "running" | "completed" | "failed"
  progress: ResearchProgress[]
  result?: ResearchResult
  error?: string
  createdAt: number
  updatedAt: number
}

const cache = new Map<string, ResearchState>()
const MAX_AGE_MS = 24 * 60 * 60 * 1000

let db: Database | null = null

function dbPath() {
  return join(getKbDir(), "research-state.db")
}

function getDb(): Database {
  if (!db) {
    const dir = getKbDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    db = new Database(dbPath())
    db.exec("PRAGMA journal_mode=WAL")
    db.exec(`CREATE TABLE IF NOT EXISTS research_states (
      research_id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      progress TEXT NOT NULL DEFAULT '[]',
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
  }
  return db
}

function rowToState(row: Record<string, unknown>): ResearchState {
  return {
    researchId: row.research_id as string,
    query: row.query as string,
    mode: row.mode as string,
    status: row.status as ResearchState["status"],
    progress: JSON.parse(row.progress as string),
    result: row.result ? JSON.parse(row.result as string) : undefined,
    error: (row.error as string) || undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

function persistState(state: ResearchState): void {
  const d = getDb()
  d.prepare(
    `INSERT OR REPLACE INTO research_states (research_id, query, mode, status, progress, result, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    state.researchId,
    state.query,
    state.mode,
    state.status,
    JSON.stringify(state.progress),
    state.result ? JSON.stringify(state.result) : null,
    state.error ?? null,
    state.createdAt,
    state.updatedAt,
  )
}

export function createResearchState(researchId: string, query: string, mode: string): ResearchState {
  const state: ResearchState = {
    researchId,
    query,
    mode,
    status: "running",
    progress: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  cache.set(researchId, state)
  persistState(state)
  return state
}

export function getResearchState(researchId: string): ResearchState | undefined {
  const cached = cache.get(researchId)
  if (cached) return cached
  const d = getDb()
  const row = d.query("SELECT * FROM research_states WHERE research_id = ?").get(researchId) as Record<string, unknown> | null
  if (!row) return undefined
  const state = rowToState(row)
  cache.set(researchId, state)
  return state
}

export function updateResearchProgress(researchId: string, progress: ResearchProgress): void {
  const state = getResearchState(researchId)
  if (!state) return
  state.progress.push(progress)
  state.updatedAt = Date.now()
  persistState(state)
}

export function completeResearch(researchId: string, result: ResearchResult): void {
  const state = getResearchState(researchId)
  if (!state) return
  state.status = "completed"
  state.result = result
  state.updatedAt = Date.now()
  persistState(state)
}

export function failResearch(researchId: string, error: string): void {
  const state = getResearchState(researchId)
  if (!state) return
  state.status = "failed"
  state.error = error
  state.updatedAt = Date.now()
  persistState(state)
}

export function cleanupOldResearch(): void {
  const cutoff = Date.now() - MAX_AGE_MS
  const d = getDb()
  d.prepare("DELETE FROM research_states WHERE updated_at < ?").run(cutoff)
  for (const [id, state] of cache) {
    if (state.updatedAt < cutoff) {
      cache.delete(id)
    }
  }
}

const cleanupTimer = setInterval(cleanupOldResearch, 5 * 60 * 1000)
cleanupTimer.unref?.()
