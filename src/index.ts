#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { writeDoc, readDoc, searchDocs, listDocs, deleteDoc, getOutline, updateOutline, slugify, searchDocsSemantic, searchDocsCombined, listAllOutlines, rebuildAllVectors, getAllKeywords } from "./storage/index.js"
import { getStorageStats, initDb } from "./search/vector-store.js"
import { handleChat } from "./chat/api-chat.js"
import { handleGetModels, handleSetModel } from "./chat/api-models.js"
import { handleListSessions, handleCreateSession, handleDeleteSession, handleGetMessages, handleRenameSession } from "./chat/api-sessions.js"
import { handleListFavorites, handleAddFavorite, handleDeleteFavorite } from "./chat/api-favorites.js"
import { handleListSessionFavorites, handleAddSessionFavorite, handleDeleteSessionFavorite } from "./chat/api-session-favorites.js"
import { handleShareSession } from "./chat/api-share.js"
import { handleScanSkills, handleGetSkillPaths, handleUpdateSkillPaths } from "./chat/api-skills.js"
import { handleBrowserDetect } from "./chat/api-browser.js"
import { loadConfig, saveConfig } from "./config.js"
import type { AppConfig } from "./config.js"

function registerTools(server: McpServer) {
  server.tool(
    "kb_write",
    `保存知识文档到知识库。当识别到跨项目可复用的方法论、架构模式、错误经验、最佳实践时，主动使用此工具保存。
支持标签：tutorial/document/analysis/guide/snippet/best-practice/reference/architecture/troubleshooting/decision`,
    {
      title: z.string().describe("文档标题"),
      content: z.string().describe("文档正文（Markdown）"),
      tags: z.array(z.string()).describe("类型标签数组"),
      keywords: z.array(z.string()).describe("关键词数组，用于检索"),
      intent: z.string().describe("创建此文档的意图或使用场景"),
      project_description: z.string().describe("当前项目简要描述"),
      source_project: z.string().optional().describe("来源项目绝对路径"),
      source_worktree: z.string().optional().describe("来源 worktree 路径"),
      related_files: z.array(z.string()).optional().describe("关联的源码文件路径数组，用于过时检测"),
    },
    async (args) => {
      const doc = writeDoc(
        {
          title: args.title,
          tags: args.tags,
          keywords: args.keywords,
          intent: args.intent,
          project_description: args.project_description,
          source_project: args.source_project || "",
          source_worktree: args.source_worktree || "",
          related_files: args.related_files,
        },
        args.content,
      )
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: doc.id,
            title: doc.title,
            file_path: doc.file_path,
            reference: `[Knowledge:${doc.title}](kb_read:${doc.id})`,
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_read",
    "读取知识文档。超200行自动截断并返回文件路径，建议用子任务读取大文档。",
    {
      id: z.string().describe("文档 ID"),
    },
    async (args) => {
      const result = readDoc(args.id, false)
      if (!result) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "文档不存在", id: args.id }) }] }
      }
      const { meta, content: rawContent } = result
      const lines = rawContent.split("\n")
      const truncated = lines.length > 200
      const content = truncated
        ? lines.slice(0, 200).join("\n")
        : rawContent
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: meta.id,
            title: meta.title,
            tags: meta.tags,
            keywords: meta.keywords,
            intent: meta.intent,
            source_project: meta.source_project,
            related_files: meta.related_files,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
            content,
            truncated,
            total_lines: lines.length,
            ...(truncated ? { hint: `文档较长(共${lines.length}行)，仅显示前200行。完整路径: ${meta.file_path}` } : {}),
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_search",
    "搜索知识文档。支持自由文本、关键词、标签多维搜索，返回匹配文档列表（不含正文）。结果包含 intent 字段作为文档摘要描述。",
    {
      query: z.string().optional().describe("自由文本搜索"),
      keywords: z.array(z.string()).optional().describe("按关键词过滤"),
      tags: z.array(z.string()).optional().describe("按标签类型过滤"),
      limit: z.number().optional().default(10).describe("返回数量上限"),
    },
    async (args) => {
      const results = searchDocs(args.query, args.keywords, args.tags, args.limit)
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total: results.length,
            documents: results.map(d => ({
              id: d.id,
              title: d.title,
              description: d.intent,
              file_path: d.file_path,
              tags: d.tags,
              keywords: d.keywords,
              source_project: d.source_project,
              related_files: d.related_files,
              score: d.score,
              snippet: d.snippet,
              matched_by: d.matched_by,
              created_at: d.created_at,
            })),
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_search_semantic",
    "语义搜索知识文档。使用 AI embedding 向量匹配，支持跨语言语义检索，比关键词搜索更智能。",
    {
      query: z.string().describe("搜索查询（自然语言描述）"),
      limit: z.number().optional().default(10).describe("返回数量上限"),
    },
    async (args) => {
      try {
        const results = await searchDocsSemantic(args.query, args.limit)
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: results.length,
              documents: results.map(d => ({
                id: d.id,
                title: d.title,
                description: d.intent,
                file_path: d.file_path,
                tags: d.tags,
                keywords: d.keywords,
                source_project: d.source_project,
                score: Math.round(d.score * 1000) / 1000,
                created_at: d.created_at,
              })),
            }, null, 2),
          }],
        }
      } catch (e: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "语义搜索失败，可能正在下载模型", detail: e.message }),
          }],
        }
      }
    },
  )

  server.tool(
    "kb_list",
    "浏览知识文档列表。可按标签或项目过滤。",
    {
      tag: z.string().optional().describe("按标签过滤"),
      project: z.string().optional().describe("按项目路径过滤"),
    },
    async (args) => {
      const docs = listDocs(args.tag, args.project)
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total: docs.length,
            documents: docs.map(d => ({
              id: d.id,
              title: d.title,
              description: d.intent,
              file_path: d.file_path,
              tags: d.tags,
              keywords: d.keywords,
              source_project: d.source_project,
              created_at: d.created_at,
            })),
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_delete",
    "删除知识文档。同步更新索引和项目大纲。",
    {
      id: z.string().describe("文档 ID"),
    },
    async (args) => {
      const ok = deleteDoc(args.id)
      return {
        content: [{
          type: "text",
          text: JSON.stringify(ok ? { success: true, id: args.id } : { success: false, error: "文档不存在" }),
        }],
      }
    },
  )

  server.tool(
    "kb_update",
    "更新知识文档。可更新正文、标题、标签、关键词。",
    {
      id: z.string().describe("文档 ID"),
      content: z.string().optional().describe("新正文"),
      title: z.string().optional().describe("新标题"),
      tags: z.array(z.string()).optional().describe("新标签"),
      keywords: z.array(z.string()).optional().describe("新关键词"),
    },
    async (args) => {
      const existing = readDoc(args.id, false)
      if (!existing) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "文档不存在", id: args.id }) }] }
      }
      const meta = existing.meta
      const content = args.content ?? existing.content
      const updated = writeDoc(
        {
          id: meta.id,
          title: args.title ?? meta.title,
          tags: args.tags ?? meta.tags,
          keywords: args.keywords ?? meta.keywords,
          intent: meta.intent,
          project_description: meta.project_description,
          source_project: meta.source_project,
          source_worktree: meta.source_worktree,
          created_at: meta.created_at,
        },
        content,
      )
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: updated.id,
            title: updated.title,
            tags: updated.tags,
            keywords: updated.keywords,
            file_path: updated.file_path,
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_outline",
    "获取项目的知识文档大纲。返回该项目所有文档的索引概览。",
    {
      project: z.string().describe("项目绝对路径"),
    },
    async (args) => {
      const outline = getOutline(args.project)
      if (!outline) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "该项目没有知识文档", project: args.project }) }] }
      }
      return { content: [{ type: "text", text: JSON.stringify(outline, null, 2) }] }
    },
  )

  server.tool(
    "file_read",
    "通过绝对路径读取文件内容，支持 offset 和 limit 参数。适用于远程访问服务器文件系统。",
    {
      path: z.string().describe("文件绝对路径"),
      offset: z.number().optional().default(0).describe("起始行号（默认 0）"),
      limit: z.number().optional().default(2000).describe("读取行数（默认 2000）"),
    },
    async (args) => {
      if (!existsSync(args.path)) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: false, error: "文件不存在" }) }] }
      }
      try {
        const raw = readFileSync(args.path, "utf-8")
        const lines = raw.split("\n")
        const totalLines = lines.length

        const start = Math.max(0, args.offset)
        const end = Math.min(totalLines, start + args.limit)
        const contentLines = lines.slice(start, end)

        const content = contentLines
          .map((line, i) => `${start + i + 1}: ${line}`)
          .join("\n")

        const truncated = end < totalLines

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              path: args.path,
              exists: true,
              content,
              total_lines: totalLines,
              truncated,
              offset: start,
              limit: args.limit,
              ...(truncated ? { hint: `文件共${totalLines}行，当前显示第${start + 1}-${end}行` } : {}),
            }, null, 2),
          }],
        }
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: true, error: e.message }) }] }
      }
    },
  )

  server.tool(
    "file_grep",
    "在指定文件中搜索文本内容。支持正则表达式和普通文本搜索。",
    {
      path: z.string().describe("文件绝对路径"),
      pattern: z.string().describe("搜索文本或正则表达式"),
      case_sensitive: z.boolean().optional().default(false).describe("是否区分大小写"),
      regex: z.boolean().optional().default(true).describe("是否使用正则表达式"),
    },
    async (args) => {
      if (!existsSync(args.path)) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: false, error: "文件不存在" }) }] }
      }
      try {
        const raw = readFileSync(args.path, "utf-8")
        const lines = raw.split("\n")

        let regex: RegExp
        try {
          const flags = args.case_sensitive ? "g" : "gi"
          regex = new RegExp(args.pattern, flags)
        } catch (e: any) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "正则表达式无效", detail: e.message }),
            }],
          }
        }

        const matches: Array<{ line: number; content: string; matched_text: string }> = []

        lines.forEach((line, index) => {
          const match = line.match(regex)
          if (match) {
            matches.push({
              line: index + 1,
              content: line,
              matched_text: match[0],
            })
          }
        })

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              path: args.path,
              exists: true,
              matches,
              total_matches: matches.length,
            }, null, 2),
          }],
        }
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: true, error: e.message }) }] }
      }
    },
  )

  server.tool(
    "file_exists",
    "检查文件或目录是否存在。用于验证路径有效性。",
    {
      path: z.string().describe("文件/目录绝对路径"),
    },
    async (args) => {
      const exists = existsSync(args.path)
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            path: args.path,
            exists,
          }, null, 2),
        }],
      }
    },
  )
}

const mcp = new McpServer({ name: "knowledge-base", version: "1.0.0" })
registerTools(mcp)

type StreamableSession = { server: McpServer, transport: StreamableHTTPServerTransport }
const streamableSessions = new Map<string, StreamableSession>()
type SSESession = { server: McpServer, transport: SSEServerTransport }
const sseSessions = new Map<string, SSESession>()

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", chunk => chunks.push(chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

function json(res: ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(body)
}

async function handleStreamableHttp(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined

  if (sessionId && streamableSessions.has(sessionId)) {
    const session = streamableSessions.get(sessionId)!
    if (!(session.transport instanceof StreamableHTTPServerTransport)) {
      json(res, { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: Session uses different transport" }, id: null }, 400)
      return
    }
    await session.transport.handleRequest(req, res, body)
    return
  }

  if (!sessionId && req.method === "POST" && body && isInitializeRequest(body)) {
    const server = new McpServer({ name: "knowledge-base", version: "1.0.0" })
    registerTools(server)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        streamableSessions.set(sid, { server, transport })
      },
    })
    transport.onclose = () => {
      if (transport.sessionId) streamableSessions.delete(transport.sessionId)
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
    return
  }

  json(res, { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID" }, id: null }, 400)
}

async function handleSSE(req: IncomingMessage, res: ServerResponse) {
  const transport = new SSEServerTransport("/messages", res)
  sseSessions.set(transport.sessionId, { server: null!, transport })
  res.on("close", () => sseSessions.delete(transport.sessionId))
  const server = new McpServer({ name: "knowledge-base", version: "1.0.0" })
  registerTools(server)
  sseSessions.set(transport.sessionId, { server, transport })
  await server.connect(transport)
}

async function handleSSEMessage(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const url = new URL(req.url!, `http://${req.headers.host}`)
  const sid = url.searchParams.get("sessionId")
  if (!sid) {
    json(res, { error: "Missing sessionId" }, 400)
    return
  }
  const session = sseSessions.get(sid)
  if (!session || !(session.transport instanceof SSEServerTransport)) {
    json(res, { error: "Session not found" }, 404)
    return
  }
  await session.transport.handlePostMessage(req, res, body)
}

async function handleRestAPI(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === "/api/docs" && req.method === "GET") {
    json(res, listDocs())
    return
  }
  if (url.pathname.startsWith("/api/doc/") && req.method === "GET") {
    const id = url.pathname.slice("/api/doc/".length)
    json(res, readDoc(id, false))
    return
  }
  if (url.pathname === "/api/docs" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    json(res, readDoc(body.id, false))
    return
  }
  if (url.pathname === "/api/docs/write" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    const { title, content, tags, keywords, intent, project_description } = body
    if (!title || !content) {
      json(res, { error: "title and content are required" }, 400)
      return
    }
    const doc = writeDoc(
      {
        title,
        tags: tags || [],
        keywords: keywords || [],
        intent: intent || "",
        project_description: project_description || "",
        source_project: "",
        source_worktree: "",
      },
      content,
    )
    json(res, doc)
    return
  }
  if (url.pathname === "/api/search/semantic" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    try {
      const results = await searchDocsSemantic(body.query, body.limit || 10)
      json(res, results.map(d => ({
        id: d.id,
        title: d.title,
        tags: d.tags,
        keywords: d.keywords,
        source_project: d.source_project,
        score: Math.round(d.score * 1000) / 1000,
        created_at: d.created_at,
      })))
    } catch (e: any) {
      json(res, { error: e.message }, 500)
    }
    return
  }
  if (url.pathname === "/api/search" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    if (body.query) {
      try {
        json(res, await searchDocsCombined(body.query, body.keywords, body.tags, body.limit))
      } catch {
        json(res, searchDocs(body.query, body.keywords, body.tags, body.limit))
      }
      return
    }
    json(res, searchDocs(body.query, body.keywords, body.tags, body.limit))
    return
  }
  if (url.pathname === "/api/outlines" && req.method === "GET") {
    json(res, listAllOutlines())
    return
  }
  if (url.pathname === "/api/outline" && req.method === "GET") {
    const project = url.searchParams.get("project")
    if (!project) { json(res, { error: "project required" }, 400); return }
    json(res, getOutline(project))
    return
  }
  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = loadConfig()
    let storage
    try { storage = getStorageStats() } catch { storage = null }
    json(res, {
      ...config,
      storage,
      embedding: {
        ...config.embedding,
        apiKey: config.embedding.apiKey ? config.embedding.apiKey.slice(0, 8) + "..." : "",
      },
    })
    return
  }
  if (url.pathname === "/api/config" && req.method === "PUT") {
    const body = JSON.parse(await readBody(req))
    const current = loadConfig()
    const update = body

    if (update.embedding?.apiKey?.endsWith("...")) {
      update.embedding.apiKey = current.embedding.apiKey
    }

    const merged: AppConfig = {
      embedding: { ...current.embedding, ...update.embedding },
      search: {
        ...current.search,
        ...update.search,
        weights: { ...current.search.weights, ...update.search?.weights },
      },
    }

    saveConfig(merged)
    json(res, { success: true })
    return
  }
  if (url.pathname === "/api/embedding/reindex" && req.method === "POST") {
    try {
      const docs = listDocs()
      if (docs.length === 0) {
        json(res, { success: true, message: "No documents to reindex" })
        return
      }
      const count = await rebuildAllVectors(docs)
      json(res, { success: true, message: `Reindexed ${count} documents` })
    } catch (e: any) {
      json(res, { success: false, error: e.message }, 500)
    }
    return
  }
  json(res, { error: "Not Found" }, 404)
}

function startHttp(port: number) {
  const serveWeb = process.argv.includes("--web")
  const webDist = join(import.meta.dir, "..", "web", "dist")
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`)

    try {
      if (url.pathname === "/mcp") {
        const body = req.method === "POST" ? JSON.parse(await readBody(req)) : undefined
        await handleStreamableHttp(req, res, body)
        return
      }
      if (url.pathname === "/sse" && req.method === "GET") {
        await handleSSE(req, res)
        return
      }
      if (url.pathname === "/messages" && req.method === "POST") {
        const body = JSON.parse(await readBody(req))
        await handleSSEMessage(req, res, body)
        return
      }
      if (url.pathname === "/health") {
        json(res, { status: "ok", service: "knowledge-base-mcp" })
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
    } catch (e: any) {
      console.error("Request error:", e)
      if (!res.headersSent) json(res, { error: e.message }, 500)
    }
  })

  server.listen(port, () => {
    console.log(`Knowledge Base MCP running on http://localhost:${port}`)
    console.log(`  StreamableHTTP: http://localhost:${port}/mcp`)
    console.log(`  SSE (legacy):   http://localhost:${port}/sse`)
    console.log(`  API:            http://localhost:${port}/api/docs`)
    if (serveWeb) {
      console.log(`  Web UI:         http://localhost:${port}`)
    }
  })
}

async function main() {
  initDb()

  const mode = process.argv.includes("--http") || process.argv.includes("--web") ? "http" : "stdio"

  if (mode === "stdio") {
    const transport = new StdioServerTransport()
    await mcp.connect(transport)
    console.error("Knowledge Base MCP running on stdio")
  } else {
    const portIdx = process.argv.indexOf("--port")
    const port = portIdx !== -1 ? parseInt(process.argv[portIdx + 1]) : 19877
    startHttp(port)
  }
}

main().catch(console.error)
