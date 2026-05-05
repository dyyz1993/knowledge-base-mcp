import type { IncomingMessage, ServerResponse } from "node:http"
import * as session from "./session"
import * as store from "./store-sessions"
import { json, readBody } from "../http.js"

export async function handleListSessions(_req: IncomingMessage, res: ServerResponse) {
  json(res, session.list())
}

export async function handleCreateSession(req: IncomingMessage, res: ServerResponse) {
  let body: Record<string, string> = {}
  try { body = JSON.parse(await readBody(req)) } catch {}
  const sess = store.createSession(body.name)
  json(res, sess)
}

export async function handleGetMessages(_req: IncomingMessage, res: ServerResponse, url: URL) {
  const match = url.pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/)
  if (!match) { json(res, { error: "Session ID required" }, 400); return }
  const msgs = session.getMessages(match[1])
  json(res, msgs)
}

export async function handleDeleteSession(req: IncomingMessage, res: ServerResponse, url: URL) {
  const id = url.pathname.split("/").pop()
  if (!id) { json(res, { error: "Session ID required" }, 400); return }
  const ok = store.deleteSession(id)
  json(res, ok ? { ok: true } : { error: "Session not found" }, ok ? 200 : 404)
}
