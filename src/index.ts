import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { writeDoc, readDoc, searchDocs, listDocs, deleteDoc, getOutline, updateOutline, slugify, searchDocsSemantic, searchDocsCombined } from "./storage/index.js"

const mcp = new McpServer({
  name: "knowledge-base",
  version: "1.0.0",
})

mcp.tool(
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

mcp.tool(
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

mcp.tool(
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

mcp.tool(
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

mcp.tool(
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

mcp.tool(
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

mcp.tool(
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

mcp.tool(
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

function startHttp(port: number) {
  Bun.serve({
    port,
    fetch: async (req) => {
      const url = new URL(req.url)

      if (url.pathname === "/sse" && req.method === "GET") {
        return handleSSE()
      }
      if (url.pathname === "/api/docs" && req.method === "GET") {
        return Response.json(listDocs())
      }
      if (url.pathname.startsWith("/api/doc/") && req.method === "GET") {
        const id = url.pathname.slice("/api/doc/".length)
        return Response.json(readDoc(id, false))
      }
      if (url.pathname === "/api/docs" && req.method === "POST") {
        const body = await req.json()
        return Response.json(readDoc(body.id, false))
      }
      if (url.pathname === "/api/search/semantic" && req.method === "POST") {
        const body = await req.json()
        try {
          const results = await searchDocsSemantic(body.query, body.limit || 10)
          return Response.json(results.map(d => ({
            id: d.id,
            title: d.title,
            tags: d.tags,
            keywords: d.keywords,
            source_project: d.source_project,
            score: Math.round(d.score * 1000) / 1000,
            created_at: d.created_at,
          })))
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 })
        }
      }
      if (url.pathname === "/api/search" && req.method === "POST") {
        const body = await req.json()
        if (body.query) {
          try {
            return Response.json(await searchDocsCombined(body.query, body.keywords, body.tags, body.limit))
          } catch {
            return Response.json(searchDocs(body.query, body.keywords, body.tags, body.limit))
          }
        }
        return Response.json(searchDocs(body.query, body.keywords, body.tags, body.limit))
      }
      if (url.pathname === "/api/outline" && req.method === "GET") {
        const project = url.searchParams.get("project")
        if (!project) return Response.json({ error: "project required" }, { status: 400 })
        return Response.json(getOutline(project))
      }
      if (url.pathname === "/health") {
        return Response.json({ status: "ok", service: "knowledge-base-mcp" })
      }
      return new Response("Not Found", { status: 404 })
    },
  })
  console.log(`Knowledge Base MCP running on http://localhost:${port}`)
  console.log(`  SSE: http://localhost:${port}/sse`)
  console.log(`  API: http://localhost:${port}/api/docs`)
}

function handleSSE(): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"))
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"))
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

main().catch(console.error)
