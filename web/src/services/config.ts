import { BASE } from "./client"
import type { AppConfig } from "./types"

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function getConfig(): Promise<AppConfig> {
  return requestJson<AppConfig>(`${BASE}/api/config`)
}

export async function updateConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  return requestJson<AppConfig>(`${BASE}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  })
}

export async function reindexEmbeddings(): Promise<{ success: boolean; message: string }> {
  return requestJson(`${BASE}/api/embedding/reindex`, { method: "POST" })
}

export async function scanSkills(): Promise<{ total: number; imported: number; skipped: number; errors: string[] }> {
  return requestJson(`${BASE}/api/skills/scan`, { method: "POST" })
}

export async function getSkillPaths(): Promise<{ paths: string[] }> {
  return requestJson(`${BASE}/api/skills/paths`)
}

export async function updateSkillPaths(paths: string[]): Promise<{ ok: boolean }> {
  return requestJson(`${BASE}/api/skills/paths`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  })
}

export async function detectBrowser(): Promise<{ path: string | null }> {
  return requestJson(`${BASE}/api/browser/detect`)
}
