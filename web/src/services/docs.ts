import { BASE } from "./client"
import type { DocMeta, OutlineProject, Outline, KBDoc } from "./types"

export async function fetchDocs(): Promise<DocMeta[]> {
  const res = await fetch(`${BASE}/api/docs`)
  return res.json()
}

export async function fetchDoc(id: string): Promise<{ meta: DocMeta; content: string; truncated: boolean } | null> {
  const res = await fetch(`${BASE}/api/docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })
  return res.json()
}

export async function searchDocs(query: string, keywords?: string[], tags?: string[], limit = 20) {
  const res = await fetch(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, keywords, tags, limit }),
  })
  return res.json()
}

export async function searchKB(query: string, limit = 10): Promise<KBDoc[]> {
  const res = await fetch(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  })
  const data = await res.json()
  return data.documents || data
}

export async function writeKB(params: {
  title: string
  content: string
  tags: string[]
  keywords: string[]
  intent?: string
}): Promise<{ id: string; title: string; filePath: string }> {
  const res = await fetch(`${BASE}/api/docs/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  return res.json()
}

export async function fetchOutlines(): Promise<OutlineProject[]> {
  const res = await fetch(`${BASE}/api/outlines`)
  return res.json()
}

export async function fetchOutline(project: string): Promise<Outline | null> {
  const res = await fetch(`${BASE}/api/outline?project=${encodeURIComponent(project)}`)
  return res.json()
}

export async function readDoc(id: string): Promise<{ meta: DocMeta; content: string; truncated: boolean } | null> {
  const res = await fetch(`${BASE}/api/doc/${encodeURIComponent(id)}`)
  return res.json()
}

export async function getDocKeywords(): Promise<{ keywords: string[]; count: number }> {
  const res = await fetch(`${BASE}/api/docs/keywords`)
  return res.json()
}
