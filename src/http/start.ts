import { readFileSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { createServer } from "node:http"
import { handleChat } from "../chat/api-chat.js"
import { handleGetModels, handleSetModel } from "../chat/api-models.js"
import { handleListSessions, handleCreateSession, handleDeleteSession, handleGetMessages, handleRenameSession } from "../chat/api-sessions.js"
import { handleListFavorites, handleAddFavorite, handleDeleteFavorite } from "../chat/api-favorites.js"
import { handleListSessionFavorites, handleAddSessionFavorite, handleDeleteSessionFavorite } from "../chat/api-session-favorites.js"
import { handleShareSession } from "../chat/api-share.js"
import { handleScanSkills, handleGetSkillPaths, handleUpdateSkillPaths } from "../chat/api-skills.js"
import { handleBrowserDetect } from "../chat/api-browser.js"
import { getAllKeywords } from "../storage/index.js"
import { readBody, json, parseBody } from "./helpers.js"
import { handleStreamableHttp, handleSSE, handleSSEMessage } from "./handle-mcp.js"
import { handleRestAPI } from "./handle-api.js"

const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8")).version
  } catch { return "2.23.0" }
})()

export function startHttp(port: number, noMcp: boolean) {
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

  // API key authentication — set KB_API_KEY env to enable
  const apiKey = process.env.KB_API_KEY
  const requireAuth = !!apiKey

  function checkAuth(req: any): boolean {
    if (!requireAuth) return true
    const auth = req.headers["authorization"] || ""
    return auth === `Bearer ${apiKey}`
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`)

    try {
      // Health check: always accessible, no auth required
      if (url.pathname === "/health") {
        json(res, { status: "ok", service: "knowledge-base-mcp", version: VERSION })
        return
      }
      // Auth gate: all endpoints except /health require authentication when KB_API_KEY is set
      if (requireAuth && !checkAuth(req)) {
        json(res, { error: "Unauthorized" }, 401)
        return
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
      if (url.pathname === "/api/share" && req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" })
        res.end()
        return
      }
      if (url.pathname.startsWith("/api/")) {
        await handleRestAPI(req, res, url)
        return
      }
      if (serveWeb) {
        if (noMcp && (url.pathname === "/mcp" || url.pathname === "/sse" || url.pathname === "/messages")) {
          json(res, { error: "MCP endpoints disabled (--no-mcp)" }, 404)
          return
        }
        const fp = join(webDist, url.pathname === "/" ? "index.html" : url.pathname)
        if (existsSync(fp)) {
          res.writeHead(200, { "Content-Type": mimeTypes[extname(fp)] || "application/octet-stream" })
          res.end(readFileSync(fp))
          return
        }
        const idx = join(webDist, "index.html")
        if (existsSync(idx)) {
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end(readFileSync(idx))
          return
        }
      }
      json(res, { error: "Not Found" }, 404)
    } catch (e: unknown) {
      console.error("Request error:", e)
      if (!res.headersSent) json(res, { error: e instanceof Error ? e.message : String(e) }, 500)
    }
  })

  server.listen(port, () => {
    console.log(`Knowledge Base MCP running on http://localhost:${port}`)
    if (!noMcp) {
      console.log(`  StreamableHTTP: http://localhost:${port}/mcp`)
      console.log(`  SSE (legacy):   http://localhost:${port}/sse`)
    }
    console.log(`  API:            http://localhost:${port}/api/docs`)
    if (noMcp) {
      console.log(`  MCP endpoints:  disabled (--no-mcp)`)
    }
    if (serveWeb) {
      console.log(`  Web UI:         http://localhost:${port}`)
    }
  })

  return server
}
