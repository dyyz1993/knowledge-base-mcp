import type { IncomingMessage, ServerResponse } from "node:http"
import * as favs from "./store-favorites"
import { json, parseBody } from "../http.js"

export async function handleListFavorites(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  json(res, favs.listFavorites())
}

export async function handleAddFavorite(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await parseBody(req, res)
  if (!body) return
  const { sessionId, messageId, content } = body as Record<string, string>
  if (!sessionId || !messageId || !content) {
    json(res, { error: "sessionId, messageId, and content are required" }, 400)
    return
  }
  const fav = favs.addFavorite({ sessionId, messageId, content })
  json(res, fav)
}

export async function handleDeleteFavorite(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const id = url.pathname.split("/").pop()
  if (!id) { json(res, { error: "Favorite ID required" }, 400); return }
  const ok = favs.deleteFavorite(id)
  json(res, ok ? { ok: true } : { error: "Favorite not found" }, ok ? 200 : 404)
}
