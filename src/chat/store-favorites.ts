import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"

const BASE_DIR = `${process.env.HOME}/.kb-chat`
const FAVORITES_PATH = `${BASE_DIR}/favorites.json`

export interface Favorite {
  id: string
  sessionId: string
  messageId: string
  content: string
  createdAt: number
}

function ensureBase() {
  if (!existsSync(BASE_DIR)) mkdirSync(BASE_DIR, { recursive: true })
}

function readAll(): Favorite[] {
  ensureBase()
  if (!existsSync(FAVORITES_PATH)) return []
  try { return JSON.parse(readFileSync(FAVORITES_PATH, "utf-8")) } catch { return [] }
}

function writeAll(favs: Favorite[]) {
  ensureBase()
  writeFileSync(FAVORITES_PATH, JSON.stringify(favs, null, 2))
}

export function listFavorites(): Favorite[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt)
}

export function addFavorite(fav: Omit<Favorite, "id" | "createdAt">): Favorite {
  const all = readAll()
  const entry: Favorite = { ...fav, id: crypto.randomUUID().slice(0, 8), createdAt: Date.now() }
  all.push(entry)
  writeAll(all)
  return entry
}

export function deleteFavorite(id: string): boolean {
  const all = readAll()
  const idx = all.findIndex(f => f.id === id)
  if (idx === -1) return false
  all.splice(idx, 1)
  writeAll(all)
  return true
}
