import { searchDocs, readDoc, listDocs, writeDoc, getOutline } from "../storage/index.js"
import { existsSync } from "node:fs"
import { expandQuery } from "./query-expander.js"

export interface OpenAITool {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const toolDefinitions: OpenAITool[] = [
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
      description: "Save a knowledge document to the knowledge base. Use when user wants to save, store, or record information, summaries, best practices, or any useful knowledge for future reference.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title (concise, descriptive)" },
          content: { type: "string", description: "Document body in Markdown format" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tags: tutorial, document, analysis, guide, snippet, best-practice, reference, architecture, troubleshooting, decision",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Keywords for search indexing",
          },
          intent: { type: "string", description: "Why this document was created or its use case" },
          project_description: { type: "string", description: "Brief description of the project this knowledge belongs to" },
          related_projects: {
            type: "array",
            items: { type: "string" },
            description: "Related project paths or names that this knowledge connects to",
          },
        },
        required: ["title", "content"],
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
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the local filesystem. Use to inspect code, config files, or any text file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path to read" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_search",
      description: "Search file contents using regex pattern matching (like grep). Use to find specific code patterns, function definitions, or text within files.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: { type: "string", description: "Directory path to search in (default: current directory)" },
          glob: { type: "string", description: "File glob pattern to filter (e.g. '*.ts', '*.json')" },
        },
        required: ["pattern"],
      },
    },
  },
]

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
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
        const proj = r.source_project ? r.source_project.split("/").pop() || "" : ""
        const projStr = proj ? `, project: ${proj}` : ""
        const base = `[${r.id ?? "?"}] ${r.title ?? "untitled"} (score: ${score}, tags: ${tags}${projStr})`
        if (r.snippet) return base + `\n  snippet: ${r.snippet}`
        return base
      }).join("\n")

      return header + body
    }
    case "kb_read": {
      const id = String(args.id ?? "")
      if (!id) return "Document ID is required."
      const doc = readDoc(id, true)
      if (!doc) return `Document ${id} not found.`
      const meta = doc.meta ?? {}
      const tags = Array.isArray(meta.tags) ? meta.tags.join(", ") : "none"
      const keywords = Array.isArray(meta.keywords) ? meta.keywords.join(", ") : "none"
      const suffix = doc.truncated ? "\n...(content truncated, showing first 50 lines)" : ""
      const related = Array.isArray(meta.related_projects) && meta.related_projects.length > 0
        ? `\nRelated Projects: ${meta.related_projects.join(", ")}`
        : ""
      return `## ${meta.title ?? id}\nTags: ${tags} | Keywords: ${keywords}\nIntent: ${meta.intent ?? "N/A"}${related}\n\n${doc.content}${suffix}`
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
      const meta = {
        title,
        tags: Array.isArray(args.tags) ? args.tags as string[] : [],
        keywords: Array.isArray(args.keywords) ? args.keywords as string[] : [],
        intent: String(args.intent ?? ""),
        project_description: String(args.project_description ?? ""),
        source_project: "",
        source_worktree: "",
        related_projects: Array.isArray(args.related_projects) ? args.related_projects as string[] : undefined,
      }
      const doc = writeDoc(meta, content)
      return `✅ Saved to knowledge base:\n  ID: ${doc.id}\n  Title: ${doc.title}\n  Tags: ${doc.tags.join(", ")}\n  Keywords: ${doc.keywords.join(", ")}\n  File: ${doc.file_path}`
    }
    case "kb_outline": {
      const project = String(args.project ?? "")
      if (!project) return "Project path is required."
      const outline = getOutline(project)
      if (!outline || !outline.docs || outline.docs.length === 0) {
        return `No knowledge base outline found for project: ${project}\nTip: Use kb_list or kb_search to find documents instead.`
      }
      const header = `📚 Project outline for ${project}\n   Updated: ${new Date(outline.updated_at).toLocaleString()}\n   Documents: ${outline.docs.length}\n\n`
      const body = outline.docs.map((d: { id: string; title: string; tags: string[]; keywords: string[] }, i: number) => {
        const tags = Array.isArray(d.tags) ? d.tags.join(", ") : "none"
        const kws = Array.isArray(d.keywords) ? d.keywords.slice(0, 5).join(", ") : "none"
        return `${i + 1}. [${d.id}] ${d.title}\n   tags: ${tags} | keywords: ${kws}`
      }).join("\n\n")
      return header + body
    }
    case "read_file": {
      const p = String(args.path ?? "")
      if (!p) return "File path is required."
      if (!existsSync(p)) return `File not found: ${p}`
      try {
        const content = await Bun.file(p).text()
        const lines = content.split("\n")
        if (lines.length > 200) return lines.slice(0, 200).join("\n") + "\n...(truncated)"
        return content
      } catch (e) {
        return `Error reading file: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    case "grep_search": {
      const pattern = String(args.pattern ?? "")
      if (!pattern) return "Search pattern is required."
      const dir = args.path ? String(args.path) : "."
      const glob = args.glob ? String(args.glob) : ""
      try {
        const args2 = ["-rn", "--include=*", pattern, dir]
        if (glob) {
          args2.splice(2, 1, `--include=${glob}`)
        }
        const proc = Bun.$`grep ${args2}`
        const out = await proc.text()
        if (!out.trim()) return `No matches found for pattern "${pattern}" in ${dir}`
        const lines = out.split("\n")
        return lines.slice(0, 50).join("\n") + (lines.length > 50 ? "\n...(truncated)" : "")
      } catch (e) {
        return `grep error: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    default:
      return `Unknown tool: ${name}`
  }
}
