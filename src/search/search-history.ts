import { Database } from "bun:sqlite"
import { join } from "node:path"
import { existsSync, mkdirSync } from "node:fs"
import { getKbDir } from "../config"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("search:search-history")

export interface SearchHistoryEntry {
  id: number
  query: string
  resultCount: number
  sources: string
  durationMs: number
  createdAt: number
}

let db: Database | null = null

function getDb(): Database {
  if (!db) {
    const dir = getKbDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    db = new Database(join(dir, "search-history.db"))
    db.exec("PRAGMA journal_mode=WAL")
    db.exec(`CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      sources TEXT NOT NULL DEFAULT '',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT 0
    )`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at DESC)`)
    db.exec(`CREATE INDEX IF NOT EXISTS idx_search_history_query ON search_history(query)`)
  }
  return db
}

export function recordSearch(query: string, resultCount: number, sources: string[], durationMs: number): void {
  try {
    const d = getDb()
    d.run(
      "INSERT INTO search_history (query, result_count, sources, duration_ms, created_at) VALUES (?, ?, ?, ?, ?)",
      [query, resultCount, sources.join(","), durationMs, Date.now()]
    )
  } catch (e) {
    logger.debug(`Failed to record search history: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function getRecentSearches(limit = 20): SearchHistoryEntry[] {
  try {
    const d = getDb()
    const rows = d.query("SELECT * FROM search_history ORDER BY created_at DESC LIMIT ?").all(limit) as SearchHistoryEntry[]
    return rows
  } catch {
    return []
  }
}

export function getTopQueries(limit = 10): Array<{ query: string; count: number }> {
  try {
    const d = getDb()
    return d.query(
      "SELECT query, COUNT(*) as count FROM search_history WHERE created_at > ? GROUP BY query ORDER BY count DESC LIMIT ?"
    ).all(Date.now() - 7 * 24 * 60 * 60 * 1000, limit) as Array<{ query: string; count: number }>
  } catch {
    return []
  }
}

export function clearOldHistory(maxAgeMs = 30 * 24 * 60 * 60 * 1000): number {
  try {
    const d = getDb()
    const cutoff = Date.now() - maxAgeMs
    const result = d.run("DELETE FROM search_history WHERE created_at < ?", [cutoff])
    return result.changes
  } catch {
    return 0
  }
}
