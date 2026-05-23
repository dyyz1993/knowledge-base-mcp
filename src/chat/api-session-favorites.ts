import type { IncomingMessage, ServerResponse } from "node:http"
import * as sf from "./store-session-favorites"
import { json, parseBody } from "../http.js"

export async function handleListSessionFavorites(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  json(res, sf.listSessionFavorites())
}

export async function handleAddSessionFavorite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseBody(req, res)
  if (!body) return
  const { sessionId, note } = body as Record<string, string>
  if (!sessionId) {
    json(res, { error: "sessionId is required" }, 400)
    return
  }
  const fav = sf.addSessionFavorite(sessionId, note)
  json(res, fav)
}

export async function handleDeleteSessionFavorite(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const id = decodeURIComponent(url.pathname.split("/").pop() || "")
  if (!id) { json(res, { error: "Session ID required" }, 400); return }
  const ok = sf.removeSessionFavorite(id)
  json(res, ok ? { ok: true } : { error: "Session favorite not found" }, ok ? 200 : 404)
}
