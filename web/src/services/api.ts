const BASE = ""

export interface DocMeta {
  id: string
  title: string
  tags: string[]
  keywords: string[]
  intent: string
  project_description: string
  source_project: string
  source_worktree: string
  created_at: number
  file_path: string
}

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

export async function fetchOutline(project: string) {
  const res = await fetch(`${BASE}/api/outline?project=${encodeURIComponent(project)}`)
  return res.json()
}
