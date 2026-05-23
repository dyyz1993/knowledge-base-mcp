import { readdirSync, readFileSync, statSync, existsSync } from "node:fs"
import { join, basename } from "node:path"
import { homedir } from "node:os"
import { writeDoc, listDocs, type DocMeta } from "../storage/index.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("chat:skill-scanner")

export interface ScanResult {
  total: number
  imported: number
  skipped: number
  errors: string[]
}

function expandPath(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p
}

interface ParsedSkill {
  name: string
  description: string
  triggers: string[]
  content: string
}

function parseSkillMd(raw: string, dirName: string): ParsedSkill {
  let content = raw
  let name = dirName
  let description = ""
  const triggers: string[] = []

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (fmMatch) {
    const [, fm, body] = fmMatch
    content = body.trim()
    for (const line of fm.split("\n")) {
      const idx = line.indexOf(":")
      if (idx === -1) continue
      const key = line.slice(0, idx).trim().toLowerCase()
      let val: string = line.slice(idx + 1).trim()
      try { val = JSON.parse(val) } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
      if (key === "name") name = val || name
      if (key === "description") description = val
      if (key === "triggers") {
        if (Array.isArray(val)) triggers.push(...val)
        else if (typeof val === "string") triggers.push(...val.split(",").map((s: string) => s.trim()))
      }
    }
  }

  if (!description) {
    const h1Match = content.match(/^#\s+(.+)$/m)
    if (h1Match) {
      description = h1Match[1].trim()
    } else {
      const firstPara = content.split(/\n\n+/).find(p => p.trim() && !p.trim().startsWith("#"))
      if (firstPara) description = firstPara.trim().slice(0, 200)
    }
  }

  return { name, description, triggers, content }
}

function extractKeywords(name: string, description: string, triggers: string[]): string[] {
  const kw = new Set<string>()
  const parts = name.split(/[-_]/)
  for (const p of parts) {
    if (p.length > 1) kw.add(p.toLowerCase())
  }
  const words = description.split(/[\s,;|.]+/).filter(w => w.length > 2)
  for (const w of words.slice(0, 10)) kw.add(w.toLowerCase())
  for (const t of triggers) {
    const tw = t.split(/[\s,;|.]+/).filter(w => w.length > 2)
    for (const w of tw.slice(0, 5)) kw.add(w.toLowerCase())
  }
  return [...kw].slice(0, 20)
}

export function scanSkillPaths(paths: string[]): ScanResult {
  const result: ScanResult = { total: 0, imported: 0, skipped: 0, errors: [] }

  for (const rawPath of paths) {
    const dir = expandPath(rawPath)
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue

    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch (e: unknown) {
      result.errors.push(`Cannot read ${dir}: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }

    for (const entry of entries) {
      const entryPath = join(dir, entry)
      try {
        if (!statSync(entryPath).isDirectory()) continue
      } catch { continue }

      const skillFile = join(entryPath, "SKILL.md")
      if (!existsSync(skillFile)) continue

      result.total++

      try {
        const raw = readFileSync(skillFile, "utf-8")
        const parsed = parseSkillMd(raw, entry)
        const keywords = extractKeywords(parsed.name, parsed.description, parsed.triggers)

        const existing = listDocs().find(
          d => d.title === parsed.name && d.source_project === entryPath
        )

        const contentToStore = parsed.content.length > 8000
          ? parsed.content.slice(0, 8000) + "\n\n... (truncated)"
          : parsed.content

        writeDoc(
          {
            ...(existing ? { id: existing.id, created_at: existing.created_at } : {}),
            title: parsed.name,
            tags: ["skill", "guide", "reference"],
            keywords,
            intent: parsed.description || `Skill: ${parsed.name}`,
            project_description: `Skill: ${parsed.name}`,
            project_path: entryPath,
            source_project: entryPath,
            source_worktree: "",
            related_projects: [],
            related_files: [skillFile],
          },
          contentToStore,
        )

        result.imported++
      } catch (e: unknown) {
        result.errors.push(`${entry}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return result
}
