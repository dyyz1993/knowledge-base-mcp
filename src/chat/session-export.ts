import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { networkInterfaces } from "node:os"
import type { ChatMessage } from "./store-sessions"
import { readMessages, readSession } from "./store-sessions"

function getLocalIP(): string {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]!) {
      if (net.family === "IPv4" && !net.internal) return net.address
    }
  }
  return "127.0.0.1"
}

export function buildShareUrl(sessionId: string, port: number): string {
  return `http://${getLocalIP()}:${port}/api/share/${sessionId}`
}

function extractToolSummary(content: string, maxLen = 200): string {
  const trimmed = content.replace(/\n+/g, " ").trim()
  if (trimmed.length <= maxLen) return trimmed
  return trimmed.slice(0, maxLen - 3) + "..."
}

function extractDocRefs(content: string): Array<{ id: string; title: string; intent?: string }> {
  const refs: Array<{ id: string; title: string; intent?: string }> = []
  const idPattern = /\[([a-zA-Z0-9_-]{6,12})\]\s+(.+?)(?:\s*\(|$)/g
  let match: RegExpExecArray | null
  while ((match = idPattern.exec(content)) !== null) {
    refs.push({ id: match[1], title: match[2].trim().split(",")[0].trim() })
  }
  const titlePattern = /##\s+(.+?)(?:\n|$)/g
  while ((match = titlePattern.exec(content)) !== null) {
    const title = match[1].trim()
    if (title && refs.length < 20) {
      const existing = refs.find(r => r.title === title)
      if (!existing) refs.push({ id: "", title })
    }
  }
  return refs
}

function extractFilePaths(content: string): string[] {
  const paths: Set<string> = new Set()
  const filePattern = /(?:^|[\s(])(\/?(?:src|lib|packages|web)\/[^\s)"',;><]+(?:\.[a-zA-Z0-9]+))/gm
  let match: RegExpExecArray | null
  while ((match = filePattern.exec(content)) !== null) {
    paths.add(match[1])
  }
  return Array.from(paths).slice(0, 10)
}

function extractProjects(content: string): string[] {
  const projects: Set<string> = new Set()
  const projPattern = /project:\s*(\S+)/g
  let match: RegExpExecArray | null
  while ((match = projPattern.exec(content)) !== null) {
    projects.add(match[1])
  }
  const pathPattern = /(?:Project Path|source_project|project_path):\s*(\/[^\s,\n"]+)/g
  while ((match = pathPattern.exec(content)) !== null) {
    projects.add(match[1])
  }
  return Array.from(projects).slice(0, 5)
}

export function exportSession(sessionId: string): string | null {
  const meta = readSession(sessionId)
  if (!meta) return null
  const messages = readMessages(sessionId)
  if (messages.length === 0) return null

  let userQuery = ""
  let conclusion = ""
  const toolsUsed: Array<{ tool: string; purpose: string; keyResult: string }> = []
  const docRefs: Map<string, { id: string; title: string; intent?: string }> = new Map()
  const allFilePaths: Set<string> = new Set()
  const allProjects: Set<string> = new Set()

  const userMsgs = messages.filter(m => m.role === "user")
  const assistantMsgs = messages.filter(m => m.role === "assistant")

  if (userMsgs.length > 0) {
    userQuery = userMsgs.map(m => m.content).join("\n\n")
  }

  if (assistantMsgs.length > 0) {
    conclusion = assistantMsgs[assistantMsgs.length - 1].content
  }

  const toolCalls = messages.filter(m => m.role === "tool_call")
  const toolResults = messages.filter(m => m.role === "tool_result")

  const callResultMap = new Map<string, string>()
  for (const tr of toolResults) {
    const key = tr.name || ""
    callResultMap.set(key, tr.content)
  }

  const seenTools = new Set<string>()
  for (const tc of toolCalls) {
    const toolName = tc.name || "unknown"
    let purpose = ""
    try {
      const args = JSON.parse(tc.args || "{}")
      purpose = args.query || args.id || args.path || args.url || ""
      if (typeof purpose === "string") purpose = purpose.slice(0, 80)
      else purpose = JSON.stringify(purpose).slice(0, 80)
    } catch {
      purpose = tc.content?.slice(0, 80) || ""
    }
    const result = callResultMap.get(toolName) || ""
    const keyResult = extractToolSummary(result)
    const dedupeKey = `${toolName}:${purpose}`
    if (!seenTools.has(dedupeKey)) {
      seenTools.add(dedupeKey)
      toolsUsed.push({ tool: toolName, purpose, keyResult })
    }

    const refs = extractDocRefs(result)
    for (const ref of refs) {
      if (ref.id) docRefs.set(ref.id, ref)
    }
    for (const fp of extractFilePaths(result)) allFilePaths.add(fp)
    for (const proj of extractProjects(result)) allProjects.add(proj)
  }

  for (const tc of toolCalls) {
    try {
      const args = JSON.parse(tc.args || "{}")
      if (args.path) allProjects.add(String(args.path))
    } catch {}
  }

  const lines: string[] = []
  lines.push(`# ${meta.name}`)
  lines.push("")
  lines.push("## User Query")
  lines.push(userQuery)
  lines.push("")
  lines.push("## Conclusion")
  lines.push(conclusion)

  if (toolsUsed.length > 0) {
    lines.push("")
    lines.push("## Tools Used")
    lines.push("| Tool | Purpose | Key Result |")
    lines.push("|------|---------|------------|")
    for (const t of toolsUsed) {
      lines.push(`| ${t.tool} | ${t.purpose.replace(/\|/g, "\\|")} | ${t.keyResult.replace(/\|/g, "\\|")} |`)
    }
  }

  if (docRefs.size > 0) {
    lines.push("")
    lines.push("## Knowledge Base References")
    for (const ref of docRefs.values()) {
      lines.push(`- **${ref.id}**: ${ref.title}${ref.intent ? ` (${ref.intent})` : ""}`)
      if (ref.id) lines.push(`  - Read: \`kb://read/${ref.id}\``)
    }
  }

  if (allFilePaths.size > 0 || allProjects.size > 0) {
    lines.push("")
    lines.push("## Resources")
    if (allProjects.size > 0) {
      lines.push(`- Project path: ${Array.from(allProjects).join(", ")}`)
    }
    if (allFilePaths.size > 0) {
      lines.push(`- Files referenced: ${Array.from(allFilePaths).join(", ")}`)
    }
  }

  lines.push("")
  lines.push("---")
  lines.push(`Exported from kb-mcp at ${new Date().toISOString()}`)
  lines.push(`Session: ${sessionId}`)

  return lines.join("\n")
}
