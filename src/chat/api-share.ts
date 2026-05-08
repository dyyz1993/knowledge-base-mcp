import type { IncomingMessage, ServerResponse } from "node:http"
import { exportSession, buildShareUrl } from "./session-export"
import { updateSessionSharedUrl } from "./store-sessions"
import { json, readBody } from "../http.js"

export async function handleShareSession(_req: IncomingMessage, res: ServerResponse, url: URL) {
  const match = url.pathname.match(/^\/api\/share\/([^/]+)$/)
  if (!match) { json(res, { error: "Session ID required" }, 400); return }
  const sessionId = match[1]
  const port = url.port ? parseInt(url.port) : 19877
  const markdown = exportSession(sessionId)
  if (!markdown) {
    json(res, { error: "Session not found or empty" }, 404)
    return
  }
  const shareUrl = buildShareUrl(sessionId, port)
  updateSessionSharedUrl(sessionId, shareUrl)
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  })
  res.end(markdown)
}
