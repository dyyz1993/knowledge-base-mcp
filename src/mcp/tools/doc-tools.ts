import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { writeDoc, readDoc, deleteDoc, getOutline } from "../../storage/index.js"

export function registerDocTools(server: McpServer): void {
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
}
