import type { DocMeta } from "./index"

export function parseFrontmatter(raw: string): { meta: Partial<DocMeta>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { meta: {}, content: raw }
  const [, frontmatter, content] = match
  const meta: Record<string, any> = {}
  for (const line of frontmatter.split("\n")) {
    const idx = line.indexOf(":")
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    let val: any = line.slice(idx + 1).trim()
    try {
      val = JSON.parse(val)
    } catch {}
    meta[key] = val
  }
  return { meta: meta as Partial<DocMeta>, content: content.trim() }
}

export function buildFrontmatter(doc: DocMeta): string {
  const fields: Record<string, unknown> = {
    id: doc.id,
    title: doc.title,
    tags: doc.tags,
    keywords: doc.keywords,
    intent: doc.intent,
    project_description: doc.project_description,
    project_path: doc.project_path,
    source_project: doc.source_project,
    source_worktree: doc.source_worktree,
    related_projects: doc.related_projects,
    related_files: doc.related_files,
    created_at: doc.created_at,
    file_path: doc.file_path,
  }
  if (doc.updated_at) fields.updated_at = doc.updated_at
  const lines = ["---"]
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`${k}: ${JSON.stringify(v)}`)
  }
  lines.push("---")
  return lines.join("\n")
}
