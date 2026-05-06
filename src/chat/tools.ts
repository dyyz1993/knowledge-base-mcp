import { searchDocs, searchDocsSemantic, searchDocsCombined, writeDoc, listDocs } from "../storage/index.js"
import { getConfiguredModels } from "./api-models"

interface ToolParam {
  type: string
  description?: string
  default?: unknown
  items?: ToolParam
  enum?: string[]
  properties?: Record<string, ToolParam>
  required?: string[]
  anyOf?: ToolParam[]
}

interface ToolSchema {
  type: "object"
  properties: Record<string, ToolParam>
  required?: string[]
}

interface AgentTool {
  name: string
  label: string
  description: string
  parameters: ToolSchema
  execute: (id: string, params: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; details?: unknown }>
}

function obj(props: Record<string, ToolParam>, required?: string[]): ToolSchema {
  return { type: "object", properties: props, ...(required ? { required } : {}) }
}

function str(desc?: string): ToolParam {
  return { type: "string", ...(desc ? { description: desc } : {}) }
}

function num(desc?: string, def?: number): ToolParam {
  return { type: "number", ...(desc ? { description: desc } : {}), ...(def !== undefined ? { default: def } : {}) }
}

function arr(items: ToolParam, desc?: string): ToolParam {
  return { type: "array", items, ...(desc ? { description: desc } : {}) }
}

function lit(values: string[]): ToolParam {
  return { type: "string", enum: values }
}

function opt(p: ToolParam, desc?: string): ToolParam {
  return { ...p, ...(desc ? { description: desc } : {}) }
}

const kbSearchTool: AgentTool = {
  name: "kb_search",
  label: "Search Knowledge Base",
  description: "搜索知识库文档。支持关键词搜索、语义搜索和组合搜索。",
  parameters: obj({
    query: str("搜索查询字符串"),
    mode: opt({ anyOf: [lit(["keyword"]), lit(["semantic"]), lit(["combined"])] }, "搜索模式"),
    limit: opt(num("返回数量限制", 10)),
  }),
  execute: async (_id, params) => {
    const limit = (params.limit as number) || 10
    let results
    if (params.mode === "semantic") {
      results = await searchDocsSemantic(params.query as string, limit)
    } else if (params.mode === "keyword") {
      results = searchDocs(params.query as string, undefined, undefined, limit)
    } else {
      results = await searchDocsCombined(params.query as string, undefined, undefined, limit)
    }
    const text = results.map((r: { id: string; title: string; score: number }) => `[${r.id}] ${r.title} (score: ${r.score.toFixed(2)})`).join("\n") || "No results found"
    return { content: [{ type: "text", text }], details: results }
  },
}

const kbWriteTool: AgentTool = {
  name: "kb_write",
  label: "Write to Knowledge Base",
  description: "写入知识库文档。创建新的知识文档并保存到知识库。",
  parameters: obj({
    title: str("文档标题"),
    content: str("文档内容 (Markdown)"),
    tags: opt(arr(str(), "标签列表")),
    keywords: opt(arr(str(), "关键词列表")),
    intent: opt(str("创建意图")),
    project_description: opt(str("项目描述")),
  }),
  execute: async (_id, params) => {
    const doc = writeDoc({
      title: params.title as string,
      tags: (params.tags as string[]) || [],
      keywords: (params.keywords as string[]) || [],
      intent: (params.intent as string) || "",
      project_description: (params.project_description as string) || "kb-chat",
      source_project: "",
      source_worktree: "",
    }, params.content as string)
    const text = `Document saved: [${doc.id}] ${doc.title} at ${doc.file_path}`
    return { content: [{ type: "text", text }], details: doc }
  },
}

const summarizeTool: AgentTool = {
  name: "summarize",
  label: "Summarize Conversation",
  description: "总结当前对话上下文。返回对话的摘要。",
  parameters: obj({
    instruction: opt(str("自定义总结指令")),
  }),
  execute: async (_id, params) => {
    const text = (params.instruction as string) || "Please summarize the current conversation."
    return { content: [{ type: "text", text: `Summary instruction: ${text}` }], details: { instruction: params.instruction } }
  },
}

const listModelsTool: AgentTool = {
  name: "list_models",
  label: "List Available Models",
  description: "列出所有可用的 LLM 模型。",
  parameters: obj({}),
  execute: async () => {
    const models = getConfiguredModels()
    const text = models.map(m => `${m.provider}/${m.id}: ${m.name}`).join("\n") || "No models available"
    return { content: [{ type: "text", text }], details: models }
  },
}

export const agentTools: AgentTool[] = [kbSearchTool, kbWriteTool, summarizeTool, listModelsTool]
