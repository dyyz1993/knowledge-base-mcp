import { BASE } from "./client"
import type { AppConfig } from "./types"

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch(`${BASE}/api/config`)
  return res.json()
}

export async function updateConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  const res = await fetch(`${BASE}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  })
  return res.json()
}

export async function reindexEmbeddings(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE}/api/embedding/reindex`, { method: "POST" })
  return res.json()
}

export async function scanSkills(): Promise<{ total: number; imported: number; skipped: number; errors: string[] }> {
  const res = await fetch(`${BASE}/api/skills/scan`, { method: "POST" })
  return res.json()
}

export async function getSkillPaths(): Promise<{ paths: string[] }> {
  const res = await fetch(`${BASE}/api/skills/paths`)
  return res.json()
}

export async function updateSkillPaths(paths: string[]): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/api/skills/paths`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  })
  return res.json()
}

export async function detectBrowser(): Promise<{ path: string | null }> {
  const res = await fetch(`${BASE}/api/browser/detect`)
  return res.json()
}
