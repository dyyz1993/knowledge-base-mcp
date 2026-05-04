#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { writeDoc, readDoc, searchDocs, listDocs, deleteDoc, getOutline, updateOutline, slugify, searchDocsSemantic, searchDocsCombined } from "./storage/index.js"

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
    "读取知识文档。超50行自动截断并返回文件路径，建议用子任务读取大文档。",
    {
      id: z.string().describe("文档 ID"),
    },
    async (args) => {
      const result = readDoc(args.id)
      if (!result) {
        return { content: [{ type: "text", text: JSON.stringify({ error: "文档不存在", id: args.id }) }] }
      }
      const { meta, content, truncated } = result
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
            created_at: meta.created_at,
            content,
            truncated,
            ...(truncated ? { hint: `文档超过50行已截断，完整路径: ${meta.file_path}，建议用子任务读取全文` } : {}),
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_search",
    "搜索知识文档。支持自由文本、关键词、标签多维搜索，返回匹配文档列表（不含正文）。",
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
              file_path: d.file_path,
              tags: d.tags,
              keywords: d.keywords,
              source_project: d.source_project,
              score: d.score,
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
      const existing = readDoc(args.id)
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
  if (url.pathname === "/api/outline" && req.method === "GET") {
    const project = url.searchParams.get("project")
    if (!project) { json(res, { error: "project required" }, 400); return }
    json(res, getOutline(project))
    return
  }
  json(res, { error: "Not Found" }, 404)
}

function startHttp(port: number) {
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
      if (url.pathname.startsWith("/api/")) {
        await handleRestAPI(req, res, url)
        return
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
  })
}

async function main() {
  const mode = process.argv.includes("--http") ? "http" : "stdio"

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
