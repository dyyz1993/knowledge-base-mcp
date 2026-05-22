import { readMessages, appendMessage, readSession, createSession, updateSessionModel, updateSessionName, listSessions } from "./store-sessions"
import type { ChatMessage, ChatSession } from "./store-sessions"

const active = new Map<string, { messages: ChatMessage[] }>()

export function getOrCreate(sessionId?: string): { session: ChatSession; messages: ChatMessage[] } {
  if (sessionId) {
    const meta = readSession(sessionId)
    if (meta) {
      const existing = active.get(sessionId)
      const messages = existing?.messages || readMessages(sessionId)
      if (!existing) active.set(sessionId, { messages })
      return { session: meta, messages }
    }
  }
  const session = createSession()
  const messages: ChatMessage[] = []
  active.set(session.id, { messages })
  return { session, messages }
}

export function pushMessage(sessionId: string, msg: ChatMessage): void {
  const entry = active.get(sessionId)
  if (entry) entry.messages.push(msg)
  appendMessage(sessionId, msg)
}

export function getMessages(sessionId: string): ChatMessage[] {
  const entry = active.get(sessionId)
  if (entry) return entry.messages
  const messages = readMessages(sessionId)
  active.set(sessionId, { messages })
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
