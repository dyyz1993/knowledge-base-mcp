import { Type } from "@dyyz1993/pi-ai"
import type { AgentTool } from "@dyyz1993/pi-agent-core"
import { searchDocs, searchDocsSemantic, searchDocsCombined, writeDoc, listDocs } from "../storage/index.js"
import { getProviders, getModels } from "@dyyz1993/pi-ai"
import { getConfiguredModels } from "./api-models"

const kbSearchTool: AgentTool = {
  name: "kb_search",
  label: "Search Knowledge Base",
  description: "搜索知识库文档。支持关键词搜索、语义搜索和组合搜索。",
  parameters: Type.Object({
    query: Type.String({ description: "搜索查询字符串" }),
    mode: Type.Optional(Type.Union([Type.Literal("keyword"), Type.Literal("semantic"), Type.Literal("combined")], { default: "combined" })),
    limit: Type.Optional(Type.Number({ description: "返回数量限制", default: 10 })),
  }),
  execute: async (_id, params) => {
    const limit = params.limit || 10
    let results
    if (params.mode === "semantic") {
      results = await searchDocsSemantic(params.query, limit)
    } else if (params.mode === "keyword") {
      results = searchDocs(params.query, undefined, undefined, limit)
    } else {
      results = await searchDocsCombined(params.query, undefined, undefined, limit)
    }
    const text = results.map(r => `[${r.id}] ${r.title} (score: ${r.score.toFixed(2)})`).join("\n") || "No results found"
    return { content: [{ type: "text", text }], details: results }
  },
}

const kbWriteTool: AgentTool = {
  name: "kb_write",
  label: "Write to Knowledge Base",
  description: "写入知识库文档。创建新的知识文档并保存到知识库。",
  parameters: Type.Object({
    title: Type.String({ description: "文档标题" }),
    content: Type.String({ description: "文档内容 (Markdown)" }),
    tags: Type.Optional(Type.Array(Type.String()), { description: "标签列表" }),
    keywords: Type.Optional(Type.Array(Type.String()), { description: "关键词列表" }),
    intent: Type.Optional(Type.String({ description: "创建意图" })),
    project_description: Type.Optional(Type.String({ description: "项目描述" })),
  }),
  execute: async (_id, params) => {
    const doc = writeDoc({
      title: params.title,
      tags: params.tags || [],
      keywords: params.keywords || [],
      intent: params.intent || "",
      project_description: params.project_description || "kb-chat",
      source_project: "",
      source_worktree: "",
    }, params.content)
    const text = `Document saved: [${doc.id}] ${doc.title} at ${doc.file_path}`
    return { content: [{ type: "text", text }], details: doc }
  },
}

const summarizeTool: AgentTool = {
  name: "summarize",
  label: "Summarize Conversation",
  description: "总结当前对话上下文。返回对话的摘要。",
  parameters: Type.Object({
    instruction: Type.Optional(Type.String({ description: "自定义总结指令" })),
  }),
  execute: async (_id, params) => {
    const text = params.instruction || "Please summarize the current conversation."
    return { content: [{ type: "text", text: `Summary instruction: ${text}` }], details: { instruction: params.instruction } }
  },
}

const listModelsTool: AgentTool = {
  name: "list_models",
  label: "List Available Models",
  description: "列出所有可用的 LLM 模型。",
  parameters: Type.Object({}),
  execute: async () => {
    const models = getConfiguredModels()
    const text = models.map(m => `${m.provider}/${m.id}: ${m.name}`).join("\n") || "No models available"
    return { content: [{ type: "text", text }], details: models }
  },
}

export const agentTools: AgentTool[] = [kbSearchTool, kbWriteTool, summarizeTool, listModelsTool]
