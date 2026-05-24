import { IncomingMessage, ServerResponse } from "node:http"
import { writeDoc, readDoc, listDocs, getOutline, listAllOutlines, listRecentDocs, deleteDoc } from "../storage/index.js"
import { json, apiError } from "./helpers.js"
import { renderRecentHtml } from "./render.js"
import { writeDocSchema, readDocByIdSchema } from "./schemas.js"
import { parseBodyTyped } from "./validate.js"

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
    const body = await parseBodyTyped(req, res, readDocByIdSchema)
    if (!body) return true
    json(res, readDoc(body.id, true))
    return true
  }
  if (url.pathname === "/api/docs/write" && req.method === "POST") {
    const body = await parseBodyTyped(req, res, writeDocSchema)
    if (!body) return true
    const { title, content, intent, project_description, source_project, source_worktree, project_path, related_projects, related_files, tags, keywords } = body
    const doc = writeDoc(
      {
        title,
        tags,
        keywords,
        intent: intent || "",
        project_description: project_description || "",
        source_project: source_project || "",
        source_worktree: source_worktree || "",
        project_path: project_path || "",
        related_projects: Array.isArray(related_projects) ? related_projects : [],
        related_files: Array.isArray(related_files) ? related_files : [],
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
    if (!project) { apiError(res, 400, "MISSING_FIELD", "project required"); return true }
    json(res, getOutline(project))
    return true
  }
  return false
}
