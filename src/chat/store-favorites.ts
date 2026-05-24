import { readFile, writeFile, mkdir, access, constants } from "node:fs/promises"
import { join } from "node:path"
import { getDataDir } from "../config"

const BASE_DIR = getDataDir()
const FAVORITES_PATH = `${BASE_DIR}/favorites.json`

export interface Favorite {
  id: string
  sessionId: string
  messageId: string
  content: string
  createdAt: number
}

async function ensureBase() {
  try {
    await access(BASE_DIR, constants.F_OK)
  } catch {
    await mkdir(BASE_DIR, { recursive: true })
  }
}

async function readAll(): Promise<Favorite[]> {
  await ensureBase()
  try {
    await access(FAVORITES_PATH, constants.F_OK)
    return JSON.parse(await readFile(FAVORITES_PATH, "utf-8"))
  } catch {
    return []
  }
}

async function writeAll(favs: Favorite[]) {
  await ensureBase()
  await writeFile(FAVORITES_PATH, JSON.stringify(favs, null, 2))
}

export async function listFavorites(): Promise<Favorite[]> {
  return (await readAll()).sort((a, b) => b.createdAt - a.createdAt)
}

export async function addFavorite(fav: Omit<Favorite, "id" | "createdAt">): Promise<Favorite> {
  const all = await readAll()
  const entry: Favorite = { ...fav, id: crypto.randomUUID().slice(0, 8), createdAt: Date.now() }
  all.push(entry)
  await writeAll(all)
  return entry
}

export async function deleteFavorite(id: string): Promise<boolean> {
  const all = await readAll()
  const idx = all.findIndex(f => f.id === id)
  if (idx === -1) return false
  all.splice(idx, 1)
  await writeAll(all)
  return true
}
