import { readMessages, appendMessage, readSession, createSession, updateSessionModel, updateSessionName, listSessions } from "./store-sessions"
import type { ChatMessage, ChatSession } from "./store-sessions"

const MAX_ACTIVE_SESSIONS = 200

const active = new Map<string, { messages: ChatMessage[]; lastAccess: number }>()

function evictIfNeeded() {
  if (active.size <= MAX_ACTIVE_SESSIONS) return
  const entries = [...active.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)
  const toRemove = entries.slice(0, 50)
  for (const [k] of toRemove) active.delete(k)
}

export function getOrCreate(sessionId?: string): { session: ChatSession; messages: ChatMessage[] } {
  if (sessionId) {
    const meta = readSession(sessionId)
    if (meta) {
      const existing = active.get(sessionId)
      const messages = existing?.messages || readMessages(sessionId)
      if (!existing) {
        evictIfNeeded()
        active.set(sessionId, { messages, lastAccess: Date.now() })
      } else {
        existing.lastAccess = Date.now()
      }
      return { session: meta, messages }
    }
  }
  const session = createSession()
  const messages: ChatMessage[] = []
  evictIfNeeded()
  active.set(session.id, { messages, lastAccess: Date.now() })
  return { session, messages }
}

export function pushMessage(sessionId: string, msg: ChatMessage): void {
  const entry = active.get(sessionId)
  if (entry) entry.messages.push(msg)
  appendMessage(sessionId, msg)
}

export function getMessages(sessionId: string): ChatMessage[] {
  const entry = active.get(sessionId)
  if (entry) {
    entry.lastAccess = Date.now()
    return entry.messages
  }
  const messages = readMessages(sessionId)
  evictIfNeeded()
  active.set(sessionId, { messages, lastAccess: Date.now() })
  return messages
}

export function setName(sessionId: string, name: string): void {
  updateSessionName(sessionId, name)
}

export function setModel(sessionId: string, model: { provider: string; id: string }): void {
  updateSessionModel(sessionId, model)
}

export function list(): ChatSession[] {
  return listSessions()
}
