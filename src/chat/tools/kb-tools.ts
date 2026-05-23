import type { OpenAITool, ToolProgressCallback } from "./types.js"
import { searchDocs, readDoc, listDocs, writeDoc, getOutline } from "../../storage/index.js"
import { expandQuery } from "../query-expander.js"

export const kbToolDefs: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "kb_search",
      description: "Search the knowledge base for relevant documents. Use this FIRST before answering any user question to find relevant context.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query - use keywords that match the user's question" },
          limit: { type: "number", description: "Max results to return (default 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kb_read",
      description: "Read a specific document from the knowledge base by its ID. Use after kb_search to get full content of a relevant document.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Document ID from kb_search results" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kb_list",
      description: "List all documents in the knowledge base, optionally filtered by tag or project.",
      parameters: {
        type: "object",
        properties: {
          tag: { type: "string", description: "Filter by tag (e.g. tutorial, guide, best-practice)" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kb_write",
      description: "Save a knowledge document to the knowledge base. ALL fields except id are required. Use when user wants to save, store, or record information, summaries, best practices, or any useful knowledge for future reference.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "文档ID（可选，传入则更新，不传则新建）" },
          title: { type: "string", description: "文档标题（必填）" },
          content: { type: "string", description: "Markdown 正文（必填）" },
          tags: { type: "array", items: { type: "string" }, description: "标签分类（必填，如 [\"reference\", \"architecture\"]）" },
          keywords: { type: "array", items: { type: "string" }, description: "搜索关键词（必填，如 [\"retry\", \"timeout\"]）" },
          intent: { type: "string", description: "文档用途说明（必填）" },
          project_description: { type: "string", description: "项目简介（必填）" },
          project_path: { type: "string", description: "项目磁盘绝对路径（必填，如 /Users/xuyingzhou/code/project）" },
          related_projects: { type: "array", items: { type: "string" }, description: "关联项目路径或名称（必填）" },
          related_files: { type: "array", items: { type: "string" }, description: "关联源码文件路径（必填，如 [\"src/index.ts\", \"src/chat/api.ts\"]）" },
        },
        required: ["title", "content", "tags", "keywords", "intent", "project_description", "project_path", "related_projects", "related_files"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "kb_outline",
      description: "Get the knowledge base outline for a specific project. Returns a list of all documents in that project with titles, tags, and keywords. Use to understand what knowledge has been captured for a project.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Absolute path of the project directory" },
        },
        required: ["project"],
      },
    },
  },
]

export async function executeKbTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "kb_search": {
      const q = String(args.query || "")
      if (!q) return "Search query is required."
      const limit = Number(args.limit) || 5

      const keywords = expandQuery(q)
      const allResults = keywords.map(k => searchDocs(k, undefined, undefined, limit))

      const bestMap = new Map<string, typeof allResults[0][0]>()
      for (const results of allResults) {
        for (const r of results) {
          const id = r.id ?? ""
          const existing = bestMap.get(id)
          if (!existing || (r.score ?? 0) > (existing.score ?? 0)) {
            bestMap.set(id, { ...r })
          }
          if (existing && !existing.snippet && r.snippet) {
            existing.snippet = r.snippet
          }
        }
      }

      const merged = Array.from(bestMap.values())
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, Math.min(Math.max(limit, 10), 20))

      if (merged.length === 0) return "No results found in knowledge base."

      const header = `🔍 Expanded "${q}" → ${keywords.length} keywords searched → ${merged.length} unique results\n`
      const body = merged.map(r => {
        const tags = Array.isArray(r.tags) ? r.tags.join(", ") : "none"
        const score = typeof r.score === "number" ? r.score.toFixed(2) : "0.00"
        const proj = r.project_path ? r.project_path.split("/").pop() || "" : (r.source_project ? r.source_project.split("/").pop() || "" : "")
        const projStr = proj ? `, project: ${proj}` : ""
        const matchInfo = Array.isArray(r.matched_by) && r.matched_by.length > 0 ? `, matched: ${r.matched_by.join("+")}` : ""
        const base = `[${r.id ?? "?"}] ${r.title ?? "untitled"} (score: ${score}, tags: ${tags}${projStr}${matchInfo})`
        if (r.snippet) return base + `\n  snippet: ${r.snippet}`
        return base
      }).join("\n")

      return header + body
    }
    case "kb_read": {
      const id = String(args.id ?? "")
      if (!id) return "Document ID is required."
      const doc = readDoc(id, false)
      if (!doc) return `Document ${id} not found.`
      const meta = doc.meta ?? {}
      const tags = Array.isArray(meta.tags) ? meta.tags.join(", ") : "none"
      const keywords = Array.isArray(meta.keywords) ? meta.keywords.join(", ") : "none"
      const related = Array.isArray(meta.related_projects) && meta.related_projects.length > 0
        ? `\nRelated Projects: ${meta.related_projects.join(", ")}`
        : ""
      const projPath = meta.project_path ? `\nProject Path: ${meta.project_path}` : ""
      const lines = doc.content.split("\n")
      const content = lines.length > 200
        ? lines.slice(0, 200).join("\n") + `\n\n...(文档较长，共${lines.length}行，仅显示前200行。可用 read_file("${meta.file_path}") 读取完整文件)`
        : doc.content
      return `## ${meta.title ?? id}\nTags: ${tags} | Keywords: ${keywords}\nIntent: ${meta.intent ?? "N/A"}${projPath}${related}\n\n${content}`
    }
    case "kb_list": {
      const tag = args.tag ? String(args.tag) : undefined
      const limit = Number(args.limit) || 20
      const docs = listDocs(tag, undefined).slice(0, limit)
      if (!docs || docs.length === 0) return "No documents found."
      return docs.map(d => {
        const tags = Array.isArray(d.tags) ? d.tags.join(", ") : "none"
        const created = d.created_at ? new Date(d.created_at).toLocaleDateString() : "unknown"
        return `[${d.id ?? "?"}] ${d.title ?? "untitled"} (tags: ${tags}, created: ${created})`
      }).join("\n")
    }
    case "kb_write": {
      const title = String(args.title ?? "")
      const content = String(args.content ?? "")
      if (!title || !content) return "title and content are required."
      const missingFields: string[] = []
      if (!Array.isArray(args.tags) || args.tags.length === 0) missingFields.push("tags")
      if (!Array.isArray(args.keywords) || args.keywords.length === 0) missingFields.push("keywords")
      if (!args.intent) missingFields.push("intent")
      if (!args.project_description) missingFields.push("project_description")
      if (!args.project_path) missingFields.push("project_path")
      if (!Array.isArray(args.related_projects) || args.related_projects.length === 0) missingFields.push("related_projects")
      if (!Array.isArray(args.related_files) || args.related_files.length === 0) missingFields.push("related_files")
      if (missingFields.length > 0) return `Missing required fields: ${missingFields.join(", ")}`
      const meta = {
        id: args.id ? String(args.id) : undefined,
        title,
        tags: args.tags as string[],
        keywords: args.keywords as string[],
        intent: String(args.intent),
        project_description: String(args.project_description),
        project_path: String(args.project_path),
        source_project: String(args.project_path),
        source_worktree: "",
        related_projects: args.related_projects as string[],
        related_files: args.related_files as string[],
      }
      const doc = writeDoc(meta, content)
      return `✅ Saved to knowledge base:\n  ID: ${doc.id}\n  Title: ${doc.title}\n  Tags: ${doc.tags.join(", ")}\n  Keywords: ${doc.keywords.join(", ")}\n  Project: ${doc.project_path}\n  File: ${doc.file_path}`
    }
    case "kb_outline": {
      const project = String(args.project ?? "")
      if (!project) return "Project path is required."
      const outline = getOutline(project)
      const docs = Array.isArray((outline as Record<string, unknown>)?.docs) ? (outline as { docs: unknown[] }).docs : []
      const updatedAt = (outline as Record<string, unknown>)?.updated_at
      if (docs.length === 0) {
        return `No knowledge base outline found for project: ${project}\nTip: Use kb_list or kb_search to find documents instead.`
      }
      const header = `📚 Project outline for ${project}\n   Updated: ${new Date(updatedAt as string | number | Date).toLocaleString()}\n   Documents: ${docs.length}\n\n`
      const body = (docs as Array<{ id: string; title: string; tags: string[]; keywords: string[] }>).map((d, i) => {
        const tags = Array.isArray(d.tags) ? d.tags.join(", ") : "none"
        const kws = Array.isArray(d.keywords) ? d.keywords.slice(0, 5).join(", ") : "none"
        return `${i + 1}. [${d.id}] ${d.title}\n   tags: ${tags} | keywords: ${kws}`
      }).join("\n\n")
      return header + body
    }
    default:
      return undefined as never
  }
}
