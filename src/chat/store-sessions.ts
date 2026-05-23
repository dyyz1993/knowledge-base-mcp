import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("chat:store-sessions")
function getSessionsDir(): string {
  return `${process.env.HOME}/.kb-chat/sessions`
}

export interface ChatSession {
  id: string
  name: string
  createdAt: number
  model: { provider: string; id: string } | null
  sharedUrl?: string
}

export interface ChatMessage {
  role: "user" | "assistant" | "thinking" | "tool_call" | "tool_result" | "suggestions" | "usage"
  content: string
  timestamp: number
  model?: string
  name?: string
  args?: string
  round?: number
  toolCalls?: unknown[]
}

function ensureBase() {
  if (!existsSync(getSessionsDir())) mkdirSync(getSessionsDir(), { recursive: true })
}

function sessionPath(id: string) {
  return join(getSessionsDir(), `${id}.jsonl`)
}

export function createSession(name?: string): ChatSession {
  ensureBase()
  const id = crypto.randomUUID().slice(0, 8)
  const session: ChatSession = { id, name: name || `Chat ${id}`, createdAt: Date.now(), model: null }
  writeFileSync(sessionPath(id), JSON.stringify({ type: "session", ...session }) + "\n")
  return session
}

export function appendMessage(id: string, msg: ChatMessage): void {
  ensureBase()
  appendFileSync(sessionPath(id), JSON.stringify(msg) + "\n")
}

export function readMessages(id: string): ChatMessage[] {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
  return lines.slice(1).map(line => {
    try { return JSON.parse(line) as ChatMessage } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)); return null }
  }).filter((m): m is ChatMessage => m !== null && m.role && m.content !== undefined && ["user", "assistant", "thinking", "tool_call", "tool_result", "suggestions", "usage"].includes(m.role))
}

export function readSession(id: string): ChatSession | null {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return null
  const firstLine = readFileSync(path, "utf-8").trim().split("\n")[0]
  try {
    const parsed = JSON.parse(firstLine)
    if (parsed.type === "session") return { id: parsed.id, name: parsed.name, createdAt: parsed.createdAt, model: parsed.model, sharedUrl: parsed.sharedUrl }
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
  return null
}

export function updateSessionSharedUrl(id: string, sharedUrl: string): void {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
  if (lines.length === 0) return
  try {
    const header = JSON.parse(lines[0])
    if (header.type === "session") {
      header.sharedUrl = sharedUrl
      lines[0] = JSON.stringify(header)
      writeFileSync(path, lines.join("\n") + "\n")
    }
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
}

export function updateSessionName(id: string, name: string): void {
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
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
}

export function updateSessionModel(id: string, model: { provider: string; id: string }): void {
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
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
}

export function listSessions(): (ChatSession & { messageCount: number })[] {
  ensureBase()
  if (!existsSync(getSessionsDir())) return []
  return readdirSync(getSessionsDir())
    .filter(f => f.endsWith(".jsonl"))
    .map(f => {
      const filePath = join(getSessionsDir(), f)
      try {
        const fd = openSync(filePath, "r")
        const buffer = Buffer.alloc(4096)
        const bytesRead = readSync(fd, buffer, 0, 4096, 0)
        closeSync(fd)
        const firstLine = buffer.toString("utf-8", 0, bytesRead).split("\n")[0]
        const header = JSON.parse(firstLine)
        if (header.type !== "session") return null
        const fileSize = statSync(filePath).size
        const estimatedLines = Math.max(1, Math.round(fileSize / 256))
        return { id: header.id as string, name: header.name as string, createdAt: header.createdAt as number, model: header.model as ChatSession["model"], sharedUrl: header.sharedUrl as string | undefined, messageCount: estimatedLines - 1 } as (ChatSession & { messageCount: number }) | null
      } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)); return null as (ChatSession & { messageCount: number }) | null }
    })
    .filter((s): s is ChatSession & { messageCount: number } => s !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export function deleteSession(id: string): boolean {
  ensureBase()
  const path = sessionPath(id)
  if (!existsSync(path)) return false
  unlinkSync(path)
  return true
}
