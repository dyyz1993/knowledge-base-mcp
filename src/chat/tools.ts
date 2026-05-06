import { searchDocs, readDoc, listDocs } from "../storage/index.js"
import { existsSync } from "node:fs"

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
      const limit = Number(args.limit) || 5
      const results = searchDocs(q, undefined, undefined, limit)
      if (results.length === 0) return "No results found in knowledge base."
      return results.map(r => {
        const base = `[${r.id}] ${r.title} (score: ${r.score.toFixed(2)}, tags: ${r.tags.join(", ")})`
        if (r.snippet) return base + `\n  snippet: ${r.snippet}`
        return base
      }).join("\n")
    }
    case "kb_read": {
      const id = String(args.id)
      const doc = readDoc(id, true)
      if (!doc) return `Document ${id} not found.`
      const suffix = doc.truncated ? "\n...(content truncated, showing first 50 lines)" : ""
      return `## ${doc.meta.title}\nTags: ${doc.meta.tags.join(", ")} | Keywords: ${doc.meta.keywords.join(", ")}\nIntent: ${doc.meta.intent}\n\n${doc.content}${suffix}`
    }
    case "kb_list": {
      const tag = args.tag ? String(args.tag) : undefined
      const limit = Number(args.limit) || 20
      const docs = listDocs(tag, undefined).slice(0, limit)
      if (docs.length === 0) return "No documents found."
      return docs.map(d => `[${d.id}] ${d.title} (tags: ${d.tags.join(", ")}, created: ${new Date(d.created_at).toLocaleDateString()})`).join("\n")
    }
    case "read_file": {
      const p = String(args.path)
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
      const pattern = String(args.pattern)
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
