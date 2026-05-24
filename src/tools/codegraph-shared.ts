import { codegraphEnv } from "../utils/spawn-env.js"

export interface CodegraphNode {
  id: string
  kind: string
  name: string
  qualifiedName?: string
  filePath?: string
  file?: string
  language?: string
  startLine?: number
  endLine?: number
  line?: number
  startColumn?: number
  endColumn?: number
  signature?: string
  visibility?: string
  isExported?: boolean
  exported?: boolean
  isAsync?: boolean
  isStatic?: boolean
  isAbstract?: boolean
  updatedAt?: string
  location?: string | { file?: string; line?: number }
}

export interface CodegraphEdge {
  source: string
  target: string
  kind: string
  line?: number
  column?: number
}

export interface CodegraphCodeBlock {
  filePath?: string
  file?: string
  startLine?: number
  endLine?: number
  language?: string
  content?: string
  code?: string
  nodeName?: string
  nodeKind?: string
}

export interface CodegraphContextResult {
  query?: string
  summary?: string
  entryPoints?: CodegraphNode[]
  symbols?: CodegraphNode[]
  nodes?: CodegraphNode[]
  edges?: CodegraphEdge[]
  codeBlocks?: CodegraphCodeBlock[]
  dependencies?: (string | { path?: string; file?: string })[]
  relatedFiles?: string[]
  stats?: {
    nodes?: number
    edges?: number
    files?: number
    codeSize?: number
    nodeCount?: number
    edgeCount?: number
    fileCount?: number
    codeBlockCount?: number
    totalCodeSize?: number
  }
  raw?: string
}

export interface CodegraphStatusResult {
  initialized?: boolean
  projectPath?: string
  files?: number
  nodes?: number
  edges?: number
  nodeCount?: number
  edgeCount?: number
  fileCount?: number
  dbSize?: number
  dbSizeBytes?: number
  backend?: string
  journalMode?: string
  languages?: string[] | string
  indexedAt?: string
  stats?: {
    files?: number
    fileCount?: number
    nodes?: number
    nodeCount?: number
    edges?: number
    edgeCount?: number
    languages?: string[] | string
    languageBreakdown?: LanguageDetail[]
    nodeKinds?: Record<string, number> | KindDetail[]
    kindBreakdown?: Record<string, number> | KindDetail[]
  }
  nodeKinds?: Record<string, number> | KindDetail[]
  kindBreakdown?: Record<string, number> | KindDetail[]
  languageBreakdown?: LanguageDetail[]
  languages_detail?: LanguageDetail[]
  raw?: string
}

export interface LanguageDetail {
  language?: string
  name?: string
  files?: number
  fileCount?: number
  nodes?: number
  nodeCount?: number
}

export interface KindDetail {
  kind?: string
  name?: string
  count: number
}

export interface CodegraphFileResult {
  path?: string
  filePath?: string
  name?: string
  language?: string
  nodeCount?: number
  nodes?: number
  symbolCount?: number
  size?: number
  classes?: string[]
  functions?: string[]
  exports?: string[]
  symbols?: FileSymbol[]
}

export interface FileSymbol {
  name: string
  kind: string
  exported?: boolean
}

export interface SpawnResult {
  stdout: string
  stderr: string
  exitCode: number
}

export function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function runCodegraph(args: string[], cwd: string, timeoutMs: number): Promise<SpawnResult> {
  const proc = Bun.spawn(["codegraph", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: codegraphEnv(),
  })

  const exitCode = await Promise.race([
    proc.exited,
    new Promise<number>((_, reject) =>
      setTimeout(() => {
        proc.kill()
        reject(new Error(`codegraph timed out after ${timeoutMs}ms`))
      }, timeoutMs),
    ),
  ])

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  return { stdout, stderr, exitCode }
}

export function buildOverviewMarkdown(projectName: string, status: CodegraphStatusResult): string {
  const lines: string[] = []
  lines.push(`# ${projectName} — Code Architecture Overview`)
  lines.push("")

  const stats = status.stats || status
  lines.push("## Stats")
  lines.push(`- Files: ${stats.files ?? stats.fileCount ?? "N/A"}`)
  lines.push(`- Nodes: ${stats.nodes ?? stats.nodeCount ?? "N/A"}`)
  lines.push(`- Edges: ${stats.edges ?? stats.edgeCount ?? "N/A"}`)
  if (stats.languages) lines.push(`- Languages: ${Array.isArray(stats.languages) ? stats.languages.join(", ") : stats.languages}`)
  if (status.dbSize) lines.push(`- DB Size: ${status.dbSize}`)
  if (status.indexedAt) lines.push(`- Indexed At: ${status.indexedAt}`)
  lines.push("")

  const langs = status.languageBreakdown || status.languages_detail || stats.languageBreakdown
  if (langs) {
    const langArr = Array.isArray(langs) ? langs : []
    if (langArr.length > 0) {
      lines.push("## Languages")
      lines.push("| Language | Files | Nodes |")
      lines.push("|----------|-------|-------|")
      for (const lang of langArr) {
        lines.push(`| ${lang.language || lang.name} | ${lang.files ?? lang.fileCount ?? 0} | ${lang.nodes ?? lang.nodeCount ?? 0} |`)
      }
      lines.push("")
    }
  }

  const kinds = status.nodeKinds || status.kindBreakdown || stats.nodeKinds || stats.kindBreakdown
  if (kinds) {
    if (typeof kinds === "object" && !Array.isArray(kinds)) {
      lines.push("## Node Distribution")
      lines.push("| Kind | Count |")
      lines.push("|------|-------|")
      for (const [kind, count] of Object.entries(kinds as Record<string, number>)) {
        lines.push(`| ${kind} | ${count} |`)
      }
      lines.push("")
    } else if (Array.isArray(kinds)) {
      lines.push("## Node Distribution")
      lines.push("| Kind | Count |")
      lines.push("|------|-------|")
      for (const k of kinds as KindDetail[]) {
        lines.push(`| ${k.kind || k.name} | ${k.count} |`)
      }
      lines.push("")
    }
  }

  lines.push("## Raw Status")
  lines.push("```json")
  lines.push(JSON.stringify(status, null, 2))
  lines.push("```")
  lines.push("")
  lines.push("---")
  lines.push("> Auto-generated by kb_ingest_codegraph")
  return lines.join("\n")
}

export function buildModuleMarkdown(projectName: string, status: CodegraphStatusResult, files: CodegraphFileResult[]): string {
  const lines: string[] = []
  lines.push(`# ${projectName} — Module Breakdown`)
  lines.push("")

  if (Array.isArray(files)) {
    for (const file of files) {
      const fp = file.path || file.filePath || file.name || "unknown"
      lines.push(`## ${fp}`)
      lines.push(`- Language: ${file.language || "unknown"}`)
      lines.push(`- Node count: ${file.nodeCount ?? file.nodes ?? file.symbolCount ?? 0}`)
      if (file.classes && Array.isArray(file.classes) && file.classes.length > 0) {
        lines.push(`- Classes: ${file.classes.join(", ")}`)
      }
      if (file.functions && Array.isArray(file.functions) && file.functions.length > 0) {
        lines.push(`- Functions: ${file.functions.join(", ")}`)
      }
      if (file.exports && Array.isArray(file.exports) && file.exports.length > 0) {
        lines.push(`- Exports: ${file.exports.join(", ")}`)
      }
      if (file.symbols && Array.isArray(file.symbols) && file.symbols.length > 0) {
        const fns = file.symbols.filter(s => s.kind === "function" || s.kind === "method").map(s => s.name)
        const cls = file.symbols.filter(s => s.kind === "class").map(s => s.name)
        const exps = file.symbols.filter(s => s.exported).map(s => s.name)
        if (cls.length > 0) lines.push(`- Classes: ${cls.join(", ")}`)
        if (fns.length > 0) lines.push(`- Functions: ${fns.join(", ")}`)
        if (exps.length > 0) lines.push(`- Exports: ${exps.join(", ")}`)
      }
      lines.push("")
    }
  } else {
    lines.push("No file data available from codegraph.")
    lines.push("")
  }

  lines.push("## Raw Data")
  lines.push("```json")
  lines.push(JSON.stringify({ status, files }, null, 2))
  lines.push("```")
  lines.push("")
  lines.push("---")
  lines.push("> Auto-generated by kb_ingest_codegraph")
  return lines.join("\n")
}

export function buildSymbolMarkdown(projectName: string, query: string, context: CodegraphContextResult): string {
  const lines: string[] = []
  lines.push(`# ${projectName} — Symbol Analysis: ${query}`)
  lines.push("")

  if (context.summary) {
    lines.push("## Summary")
    lines.push(context.summary)
    lines.push("")
  }

  if (context.entryPoints && Array.isArray(context.entryPoints) && context.entryPoints.length > 0) {
    lines.push("## Entry Points")
    for (const ep of context.entryPoints) {
      const epName = typeof ep === "string" ? ep : ep.name
      const epKind = typeof ep === "string" ? "unknown" : (ep.kind || "unknown")
      const epFile = typeof ep === "string" ? "" : (ep.file || ep.filePath || "")
      const epLine = typeof ep === "string" ? "" : (ep.line ?? "")
      lines.push(`- ${epName} (${epKind}) at ${epFile}:${epLine}`)
    }
    lines.push("")
  }

  if (context.symbols && Array.isArray(context.symbols) && context.symbols.length > 0) {
    lines.push("## Key Symbols")
    for (const sym of context.symbols.slice(0, 30)) {
      lines.push(`### ${sym.name} (${sym.kind || "unknown"})`)
      if (sym.signature) lines.push(`- Signature: \`${sym.signature}\``)
      if (sym.file || sym.location) {
        const loc = sym.location || sym.file
        lines.push(`- Location: ${typeof loc === "string" ? loc : `${(loc as { file?: string; line?: number }).file || sym.file || ""}:${(loc as { file?: string; line?: number }).line || ""}`}`)
      }
      if (sym.exported !== undefined) lines.push(`- Exported: ${sym.exported}`)
      lines.push("")
    }
  }

  if (context.codeBlocks && Array.isArray(context.codeBlocks) && context.codeBlocks.length > 0) {
    lines.push("## Code Blocks")
    for (const block of context.codeBlocks.slice(0, 15)) {
      const loc = block.file ? `${block.file}:${block.startLine || ""}-${block.endLine || ""}` : "unknown"
      lines.push(`### ${loc}`)
      lines.push(`\`\`\`${block.language || ""}`)
      lines.push(block.content || block.code || "")
      lines.push("```")
      lines.push("")
    }
  }

  if (context.dependencies && Array.isArray(context.dependencies) && context.dependencies.length > 0) {
    lines.push("## Dependencies")
    for (const dep of context.dependencies) {
      lines.push(`- ${typeof dep === "string" ? dep : dep.path || dep.file || JSON.stringify(dep)}`)
    }
    lines.push("")
  }

  if (context.stats) {
    lines.push("## Stats")
    const s = context.stats
    lines.push(`- Nodes: ${s.nodes ?? "N/A"}, Edges: ${s.edges ?? "N/A"}, Files: ${s.files ?? "N/A"}, Code Size: ${s.codeSize ?? "N/A"}`)
    lines.push("")
  }

  lines.push("## Raw Context")
  lines.push("```json")
  lines.push(JSON.stringify(context, null, 2))
  lines.push("```")
  lines.push("")
  lines.push("---")
  lines.push("> Auto-generated by kb_ingest_codegraph")
  return lines.join("\n")
}

export function extractKeywords(projectName: string, status: CodegraphStatusResult, files?: CodegraphFileResult[]): string[] {
  const kw = new Set<string>()
  kw.add(projectName)
  if (status.stats?.languages) {
    const langs = Array.isArray(status.stats.languages) ? status.stats.languages : [status.stats.languages]
    for (const l of langs) kw.add(String(l))
  }
  if (status.stats?.languageBreakdown) {
    for (const l of status.stats.languageBreakdown) kw.add(l.language || l.name || "")
  }
  if (status.languageBreakdown) {
    for (const l of status.languageBreakdown) kw.add(l.language || l.name || "")
  }
  if (files && Array.isArray(files)) {
    const dirs = new Set<string>()
    for (const f of files.slice(0, 50)) {
      const fp = f.path || f.filePath || f.name || ""
      const parts = fp.split("/")
      if (parts.length > 1) dirs.add(parts[0])
    }
    for (const d of dirs) kw.add(d)
  }
  return [...kw].filter(k => k.length > 0).slice(0, 12)
}

export function extractRelatedFiles(files: CodegraphFileResult[]): string[] {
  if (!Array.isArray(files)) return []
  return files
    .map(f => f.path || f.filePath || f.name || "")
    .filter(p => p.length > 0)
    .slice(0, 50)
}
