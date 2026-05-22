import type { IncomingMessage, ServerResponse } from "node:http"
import * as session from "./session"
import * as store from "./store-sessions"
import * as sf from "./store-session-favorites"
import { json, readBody } from "../http.js"

export async function handleListSessions(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sessions = session.list().map(s => ({ ...s, favorited: sf.isSessionFavorited(s.id) }))
  json(res, sessions)
}

export async function handleCreateSession(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Record<string, string> = {}
  try { body = JSON.parse(await readBody(req)) } catch (e) { console.warn("[api-sessions]", e instanceof Error ? e.message : String(e)) }
  const sess = store.createSession(body.name)
  json(res, sess)
}

export async function handleRenameSession(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const id = url.pathname.split("/").filter(Boolean)[2]
  if (!id) { json(res, { error: "Session ID required" }, 400); return }
  let body: Record<string, string> = {}
  try { body = JSON.parse(await readBody(req)) } catch (e) { console.warn("[api-sessions]", e instanceof Error ? e.message : String(e)) }
  if (!body.name) { json(res, { error: "Name required" }, 400); return }
  session.setName(id, body.name)
  json(res, { ok: true })
}

export async function handleGetMessages(_req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/)
  if (!match) { json(res, { error: "Session ID required" }, 400); return }
  const msgs = session.getMessages(match[1])
  json(res, msgs)
}

export async function handleDeleteSession(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const id = url.pathname.split("/").pop()
  if (!id) { json(res, { error: "Session ID required" }, 400); return }
  const ok = store.deleteSession(id)
  json(res, ok ? { ok: true } : { error: "Session not found" }, ok ? 200 : 404)
}
