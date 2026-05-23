import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { searchDocs, searchDocsSemantic, listDocs, listRecentDocs } from "../../storage/index.js"
import { kbAskPipeline } from "../../search/kb-ask-pipeline.js"

export function registerSearchTools(server: McpServer): void {
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
      } catch (e: unknown) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "语义搜索失败，可能正在下载模型", detail: e instanceof Error ? e.message : String(e) }),
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
    "kb_recent",
    "获取最近插入的知识文档，用于快速回顾和汇总近期工作。支持按时间范围过滤（如最近24/72小时）。",
    {
      hours: z.number().default(24).describe("查询最近多少小时内的文档，默认24"),
      limit: z.number().default(50).describe("最大返回数量，默认50"),
      include_content: z.boolean().default(false).describe("是否返回完整内容，默认false仅返回摘要"),
    },
    async (args) => {
      const results = listRecentDocs({
        hours: args.hours,
        limit: args.limit,
        include_content: args.include_content,
      })
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total: results.length,
            hours: args.hours,
            documents: results.map(r => ({
              id: r.meta.id,
              title: r.meta.title,
              intent: r.meta.intent,
              tags: r.meta.tags,
              keywords: r.meta.keywords,
              source_project: r.meta.source_project,
              project_description: r.meta.project_description,
              created_at: r.meta.created_at,
              updated_at: r.meta.updated_at,
              snippet: r.snippet,
              ...(r.content ? { content: r.content } : {}),
            })),
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_ask",
    `智能查询：先分析用户意图，用多维度搜索知识库，评估结果质量，不满足则重写查询回流重试（最多2次），最终没命中则返回 Miss Task 引导 Agent 搜索后存储。
返回 { from_kb: boolean, quality: "high"|"medium"|"low", loops_used: number, queries_used: [...], content: "..." }`,
    {
      query: z.string().describe("自然语言查询"),
      max_web_results: z.number().optional().default(3).describe("联网搜索最大结果数（默认 3）"),
      auto_save: z.boolean().optional().default(true).describe("是否自动存入知识库（默认 true）"),
    },
    async (args) => {
      const result = await kbAskPipeline(args.query, args.max_web_results ?? 3)

      if (result.from_kb) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              from_kb: true,
              id: result.id,
              title: result.title,
              score: result.score,
              quality: result.quality,
              completeness: result.completeness,
              content: result.content,
              loops_used: result.loops_used,
              queries_used: result.queries_used,
              ...(result.web_search_suggestion ? { web_search_suggestion: result.web_search_suggestion } : {}),
              ...(result.web_results ? { web_results: result.web_results } : {}),
              ...(result.auto_saved ? { auto_saved: result.auto_saved } : {}),
              hint: result.hint,
            }, null, 2),
          }],
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            from_kb: false,
            miss: result.miss,
            query: args.query,
            queries_tried: result.queries_used,
            loops_used: result.loops_used,
            miss_stats: result.miss_stats,
            suggested_workflow: result.suggested_workflow,
            alternative_workflows: result.alternative_workflows,
            ...(result.web_results ? { web_results: result.web_results } : {}),
            ...(result.auto_saved ? { auto_saved: result.auto_saved } : {}),
            ...(result.content ? { content: result.content } : {}),
            hint: result.hint,
          }, null, 2),
        }],
      }
    },
  )
}
