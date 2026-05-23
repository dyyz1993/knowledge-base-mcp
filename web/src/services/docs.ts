import { BASE } from "./client"
import type { DocMeta, OutlineProject, Outline, KBDoc } from "./types"

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function fetchDocs(): Promise<DocMeta[]> {
  return requestJson<DocMeta[]>(`${BASE}/api/docs`)
}

export async function fetchDoc(id: string): Promise<{ meta: DocMeta; content: string; truncated: boolean } | null> {
  return requestJson(`${BASE}/api/docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })
}

export async function searchDocs(query: string, keywords?: string[], tags?: string[], limit = 20): Promise<DocMeta[]> {
  const data = await requestJson<DocMeta[] | { documents: DocMeta[] }>(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, keywords, tags, limit }),
  })
  return Array.isArray(data) ? data : data.documents
}

export async function searchKB(query: string, limit = 10): Promise<KBDoc[]> {
  const data = await requestJson<KBDoc[] | { documents: KBDoc[] }>(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  })
  return Array.isArray(data) ? data : data.documents
}

export async function writeKB(params: {
  title: string
  content: string
  tags: string[]
  keywords: string[]
  intent?: string
}): Promise<{ id: string; title: string; filePath: string }> {
  return requestJson(`${BASE}/api/docs/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
}

export async function fetchOutlines(): Promise<OutlineProject[]> {
  return requestJson<OutlineProject[]>(`${BASE}/api/outlines`)
}

export async function fetchOutline(project: string): Promise<Outline | null> {
  return requestJson(`${BASE}/api/outline?project=${encodeURIComponent(project)}`)
}

export async function readDoc(id: string): Promise<{ meta: DocMeta; content: string; truncated: boolean } | null> {
  return requestJson(`${BASE}/api/doc/${encodeURIComponent(id)}`)
}

export async function getDocKeywords(): Promise<{ keywords: string[]; count: number }> {
  return requestJson(`${BASE}/api/docs/keywords`)
}
