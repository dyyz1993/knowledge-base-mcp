import type { IncomingMessage, ServerResponse } from "node:http"
import { exportSession, buildShareUrl } from "./session-export"
import { updateSessionSharedUrl } from "./store-sessions"
import { json, readBody } from "../http.js"

export async function handleShareSession(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
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
  const allowedOrigins = [
    "http://localhost:19877", "http://localhost:3000", "http://localhost:5173",
    "http://127.0.0.1:19877", "http://127.0.0.1:3000", "http://127.0.0.1:5173",
  ]
  const requestOrigin = req.headers.origin || ""
  const origin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0]
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  })
  res.end(markdown)
}
