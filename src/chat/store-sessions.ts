import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const BASE_DIR = `${process.env.HOME}/.kb-chat`
const SESSIONS_DIR = `${BASE_DIR}/sessions`

export interface ChatSession {
  id: string
  name: string
  createdAt: number
  model: { provider: string; id: string } | null
}

export interface ChatMessage {
  role: "user" | "assistant" | "thinking" | "tool_call" | "tool_result" | "suggestions"
  content: string
  timestamp: number
  model?: string
  name?: string
  args?: string
  round?: number
  toolCalls?: unknown[]
}

function ensureBase() {
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true })
}

function sessionPath(id: string) {
  return join(SESSIONS_DIR, `${id}.jsonl`)
}

export function createSession(name?: string): ChatSession {
  ensureBase()
  const id = crypto.randomUUID().slice(0, 8)
  const session: ChatSession = { id, name: name || `Chat ${id}`, createdAt: Date.now(), model: null }
  writeFileSync(sessionPath(id), JSON.stringify({ type: "session", ...session }) + "\n")
  return session
}

export function appendMessage(id: string, msg: ChatMessage) {
  ensureBase()
  appendFileSync(sessionPath(id), JSON.stringify(msg) + "\n")
}

export function readMessages(id: string): ChatMessage[] {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
  return lines.slice(1).map(line => {
    try { return JSON.parse(line) as ChatMessage } catch { return null }
  }).filter((m): m is ChatMessage => m !== null && m.role && m.content !== undefined && ["user", "assistant", "thinking", "tool_call", "tool_result", "suggestions"].includes(m.role))
}

export function readSession(id: string): ChatSession | null {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return null
  const firstLine = readFileSync(path, "utf-8").trim().split("\n")[0]
  try {
    const parsed = JSON.parse(firstLine)
    if (parsed.type === "session") return { id: parsed.id, name: parsed.name, createdAt: parsed.createdAt, model: parsed.model }
  } catch {}
  return null
}

export function updateSessionName(id: string, name: string) {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
  if (lines.length === 0) return
  try {
    const header = JSON.parse(lines[0])
    if (header.type === "session") {
      header.name = name
      lines[0] = JSON.stringify(header)
      writeFileSync(path, lines.join("\n") + "\n")
    }
  } catch {}
}

export function updateSessionModel(id: string, model: { provider: string; id: string }) {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
  if (lines.length === 0) return
  try {
    const header = JSON.parse(lines[0])
    if (header.type === "session") {
      header.model = model
      lines[0] = JSON.stringify(header)
      writeFileSync(path, lines.join("\n") + "\n")
    }
  } catch {}
}

export function listSessions(): (ChatSession & { messageCount: number })[] {
  ensureBase()
  if (!existsSync(SESSIONS_DIR)) return []
  return readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => {
      const content = readFileSync(join(SESSIONS_DIR, f), "utf-8")
      const lines = content.trim().split("\n").filter(Boolean)
      if (lines.length === 0) return null
      try {
        const header = JSON.parse(lines[0])
        if (header.type !== "session") return null
        return { id: header.id, name: header.name, createdAt: header.createdAt, model: header.model, messageCount: lines.length - 1 }
      } catch { return null }
    })
    .filter((s): s is ChatSession & { messageCount: number } => s !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function deleteSession(id: string): boolean {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}
