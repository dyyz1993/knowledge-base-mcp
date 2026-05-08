import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

const BASE_DIR = `${process.env.HOME}/.kb-chat`
const FILE_PATH = `${BASE_DIR}/session-favorites.json`

export interface SessionFavorite {
  sessionId: string
  pinnedAt: number
  note?: string
}

function ensureBase() {
  if (!existsSync(BASE_DIR)) mkdirSync(BASE_DIR, { recursive: true })
}

function readAll(): SessionFavorite[] {
  ensureBase()
  if (!existsSync(FILE_PATH)) return []
  try { return JSON.parse(readFileSync(FILE_PATH, "utf-8")) } catch { return [] }
}

function writeAll(favs: SessionFavorite[]) {
  ensureBase()
  writeFileSync(FILE_PATH, JSON.stringify(favs, null, 2))
}

export function listSessionFavorites(): SessionFavorite[] {
  return readAll().sort((a, b) => b.pinnedAt - a.pinnedAt)
}

export function addSessionFavorite(sessionId: string, note?: string): SessionFavorite {
  const all = readAll()
  const existing = all.find(f => f.sessionId === sessionId)
  if (existing) {
    if (note !== undefined) existing.note = note
    writeAll(all)
    return existing
  }
  const entry: SessionFavorite = { sessionId, pinnedAt: Date.now(), note }
  all.push(entry)
  writeAll(all)
  return entry
}

export function removeSessionFavorite(sessionId: string): boolean {
  const all = readAll()
  const idx = all.findIndex(f => f.sessionId === sessionId)
  if (idx === -1) return false
  all.splice(idx, 1)
  writeAll(all)
  return true
}

export function isSessionFavorited(sessionId: string): boolean {
  return readAll().some(f => f.sessionId === sessionId)
}
