import { readFileSync, existsSync } from "node:fs"
import { join, extname, resolve } from "node:path"
import { createServer, type IncomingMessage } from "node:http"
import { handleChat } from "../chat/api-chat.js"
import { handleGetModels, handleSetModel } from "../chat/api-models.js"
import { handleListSessions, handleCreateSession, handleDeleteSession, handleGetMessages, handleRenameSession } from "../chat/api-sessions.js"
import { handleListFavorites, handleAddFavorite, handleDeleteFavorite } from "../chat/api-favorites.js"
import { handleListSessionFavorites, handleAddSessionFavorite, handleDeleteSessionFavorite } from "../chat/api-session-favorites.js"
import { handleShareSession } from "../chat/api-share.js"
import { handleScanSkills, handleGetSkillPaths, handleUpdateSkillPaths } from "../chat/api-skills.js"
import { handleBrowserDetect } from "../chat/api-browser.js"
import { getAllKeywords } from "../storage/index.js"
import { readBody, json, apiError, parseBody, createTieredRateLimiter, getCorsHeaders } from "./helpers.js"
import { handleStreamableHttp, handleSSE, handleSSEMessage } from "./handle-mcp.js"
import { handleRestAPI } from "./handle-api.js"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("http:start")
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8")).version
  } catch { return "2.23.0" }
})()

export function startHttp(port: number, noMcp: boolean, options?: { apiKey?: string }) {
  const serveWeb = process.argv.includes("--web")
  const webDist = join(import.meta.dir, "..", "..", "web", "dist")
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  }

  // API key authentication — set KB_API_KEY env to enable, or pass via options
  const apiKey = options?.apiKey ?? process.env.KB_API_KEY
  const requireAuth = !!apiKey

  function checkAuth(req: IncomingMessage): boolean {
    if (!requireAuth) return true
    const auth = req.headers["authorization"] || ""
    return auth === `Bearer ${apiKey}`
  }

  // Tiered rate limiter: different limits per endpoint category
  const rateLimit = createTieredRateLimiter()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`)

    try {
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.setHeader("X-Frame-Options", "DENY")
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' https:; font-src 'self' data:; worker-src 'self' blob:")

      const corsHeaders = getCorsHeaders(req.headers.origin)
      for (const [k, v] of Object.entries(corsHeaders)) {
        res.setHeader(k, v)
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204)
        res.end()
        return
      }

      // Health check: always accessible, no auth required
      if (url.pathname === "/health") {
        json(res, { status: "ok", service: "knowledge-base-mcp", version: VERSION })
        return
      }
      // Auth gate: all endpoints except /health require authentication when KB_API_KEY is set
      if (requireAuth && !checkAuth(req)) {
        apiError(res, 401, "UNAUTHORIZED", "Unauthorized")
        return
      }
      // Rate limit: tiered by endpoint category
      if (url.pathname.startsWith("/api/")) {
        const { allowed, retryAfterMs, limit, remaining } = rateLimit(req, url.pathname)
        res.setHeader("X-RateLimit-Limit", String(limit))
        res.setHeader("X-RateLimit-Remaining", String(remaining))
        if (!allowed) {
          res.writeHead(429, {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
          })
          res.end(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests" }, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }))
          return
        }
      }
      if (!noMcp && url.pathname === "/mcp") {
        const body = req.method === "POST" ? await parseBody(req, res) : undefined
        if (body === null && req.method === "POST") return
        await handleStreamableHttp(req, res, body)
        return
      }
      if (!noMcp && url.pathname === "/sse" && req.method === "GET") {
        await handleSSE(req, res)
        return
      }
      if (!noMcp && url.pathname === "/messages" && req.method === "POST") {
        const body = await parseBody(req, res)
        if (body === null) return
        await handleSSEMessage(req, res, body)
        return
      }
      if (url.pathname === "/api/chat" && req.method === "POST") return handleChat(req, res)
      if (url.pathname === "/api/models" && req.method === "GET") return handleGetModels(req, res)
      if (url.pathname === "/api/models" && req.method === "PUT") return handleSetModel(req, res)
      if (url.pathname === "/api/sessions" && req.method === "GET") return handleListSessions(req, res)
      if (url.pathname === "/api/sessions" && req.method === "POST") return handleCreateSession(req, res)
      if (url.pathname.match(/^\/api\/sessions\/[^/]+\/rename$/) && req.method === "PUT") return handleRenameSession(req, res, url)
      if (url.pathname.match(/^\/api\/sessions\/[^/]+\/messages$/) && req.method === "GET") return handleGetMessages(req, res, url)
      if (url.pathname.startsWith("/api/sessions/") && req.method === "DELETE") return handleDeleteSession(req, res, url)
      if (url.pathname === "/api/favorites" && req.method === "GET") return handleListFavorites(req, res)
      if (url.pathname === "/api/favorites" && req.method === "POST") return handleAddFavorite(req, res)
      if (url.pathname.startsWith("/api/favorites/") && req.method === "DELETE") return handleDeleteFavorite(req, res, url)
      if (url.pathname === "/api/session-favorites" && req.method === "GET") return handleListSessionFavorites(req, res)
      if (url.pathname === "/api/session-favorites" && req.method === "POST") return handleAddSessionFavorite(req, res)
      if (url.pathname.startsWith("/api/session-favorites/") && req.method === "DELETE") return handleDeleteSessionFavorite(req, res, url)
      if (url.pathname.match(/^\/api\/share\/[^/]+$/) && req.method === "GET") return handleShareSession(req, res, url)
      if (url.pathname === "/api/skills/scan" && req.method === "POST") return handleScanSkills(req, res)
      if (url.pathname === "/api/skills/paths" && req.method === "GET") return handleGetSkillPaths(req, res)
      if (url.pathname === "/api/skills/paths" && req.method === "PUT") return handleUpdateSkillPaths(req, res)
      if (url.pathname === "/api/browser/detect" && req.method === "GET") return handleBrowserDetect(req, res)
      if (url.pathname === "/api/docs/keywords" && req.method === "GET") { json(res, getAllKeywords()); return }
      if (url.pathname.startsWith("/api/")) {
        await handleRestAPI(req, res, url)
        return
      }
      if (serveWeb) {
        if (noMcp && (url.pathname === "/mcp" || url.pathname === "/sse" || url.pathname === "/messages")) {
          apiError(res, 404, "NOT_FOUND", "MCP endpoints disabled (--no-mcp)")
          return
        }
        const fp = join(webDist, url.pathname === "/" ? "index.html" : url.pathname)
        const resolvedFp = resolve(fp)
        const resolvedWebDist = resolve(webDist)
        if (!resolvedFp.startsWith(resolvedWebDist)) {
          res.writeHead(403, { "Content-Type": "text/plain" })
          res.end("Forbidden")
          return
        }
        if (existsSync(fp)) {
          const ext = extname(fp)
          const contentType = mimeTypes[ext] || "application/octet-stream"

          const isAsset = url.pathname.startsWith("/assets/")
          const isHtml = ext === ".html"
          if (isAsset) {
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable")
          } else if (isHtml) {
            res.setHeader("Cache-Control", "no-cache")
          } else {
            res.setHeader("Cache-Control", "public, max-age=3600")
          }

          const acceptEncoding = req.headers["accept-encoding"] || ""
          const gzPath = fp + ".gz"
          if (acceptEncoding.includes("gzip") && existsSync(gzPath)) {
            res.writeHead(200, {
              "Content-Type": contentType,
              "Content-Encoding": "gzip",
            })
            res.end(readFileSync(gzPath))
            return
          }

          res.writeHead(200, { "Content-Type": contentType })
          res.end(readFileSync(fp))
          return
        }
        const idx = join(webDist, "index.html")
        if (existsSync(idx)) {
          res.setHeader("Cache-Control", "no-cache")
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end(readFileSync(idx))
          return
        }
      }
      apiError(res, 404, "NOT_FOUND", "Not Found")
    } catch (e: unknown) {
      logger.error("Request error:", e)
      if (!res.headersSent) apiError(res, 500, "INTERNAL_ERROR", e instanceof Error ? e.message : String(e))
    }
  })

  server.listen(port, () => {
    logger.info(`Knowledge Base MCP running on http://localhost:${port}`)
    if (!noMcp) {
      logger.info(`  StreamableHTTP: http://localhost:${port}/mcp`)
      logger.info(`  SSE (legacy):   http://localhost:${port}/sse`)
    }
    logger.info(`  API:            http://localhost:${port}/api/docs`)
    if (noMcp) {
      logger.info(`  MCP endpoints:  disabled (--no-mcp)`)
    }
    if (serveWeb) {
      logger.info(`  Web UI:         http://localhost:${port}`)
    }
  })

  return server
}
