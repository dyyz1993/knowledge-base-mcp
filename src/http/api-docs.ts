import { IncomingMessage, ServerResponse } from "node:http"
import { writeDoc, readDoc, listDocs, getOutline, listAllOutlines, listRecentDocs, deleteDoc } from "../storage/index.js"
import { json, parseBody } from "./helpers.js"
import { renderRecentHtml } from "./render.js"

export async function handleDocsRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname === "/api/docs" && req.method === "GET") {
    json(res, listDocs())
    return true
  }
  if (url.pathname === "/api/docs/recent" && req.method === "GET") {
    const hours = parseInt(url.searchParams.get("hours") || "24", 10) || 24
    const since = url.searchParams.get("since") ? (parseInt(url.searchParams.get("since")!, 10) || undefined) : undefined
    const limit = parseInt(url.searchParams.get("limit") || "50", 10) || 50
    const include_content = url.searchParams.get("include_content") === "true"
    const format = url.searchParams.get("format") || "json"
    const results = listRecentDocs({ hours, since, limit, include_content })
    if (format === "html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(renderRecentHtml(results, hours))
    } else {
      json(res, results)
    }
    return true
  }
  if (url.pathname.startsWith("/api/doc/") && req.method === "GET") {
    const id = url.pathname.slice("/api/doc/".length)
    json(res, readDoc(id, true))
    return true
  }
  if (url.pathname.startsWith("/api/doc/") && req.method === "DELETE") {
    const id = url.pathname.slice("/api/doc/".length)
    const ok = deleteDoc(id)
    json(res, { deleted: ok, id })
    return true
  }
  if (url.pathname === "/api/docs" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    json(res, readDoc(body.id, true))
    return true
  }
  if (url.pathname === "/api/docs/write" && req.method === "POST") {
    const body = (await parseBody(req, res)) as Record<string, any>
    if (body === null) return true
    const { title, content, intent, project_description } = body
    if (!title || !content || typeof title !== "string" || typeof content !== "string") {
      json(res, { error: "title and content are required strings" }, 400)
      return true
    }
    const tags = Array.isArray(body.tags) ? body.tags : []
    const keywords = Array.isArray(body.keywords) ? body.keywords : []
    const doc = writeDoc(
      {
        title,
        tags,
        keywords,
        intent: intent || "",
        project_description: project_description || "",
        source_project: "",
        source_worktree: "",
      },
      content,
    )
    json(res, doc)
    return true
  }
  if (url.pathname === "/api/outlines" && req.method === "GET") {
    json(res, listAllOutlines())
    return true
  }
  if (url.pathname === "/api/outline" && req.method === "GET") {
    const project = url.searchParams.get("project")
    if (!project) { json(res, { error: "project required" }, 400); return true }
    json(res, getOutline(project))
    return true
  }
  return false
}
