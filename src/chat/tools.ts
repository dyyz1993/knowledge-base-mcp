import { searchDocs, readDoc, listDocs, writeDoc, getOutline } from "../storage/index.js"
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
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
          related_files: {
            type: "array",
            items: { type: "string" },
            description: "Related source file paths for staleness detection",
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
      name: "scan_project",
      description: "Scan a project directory to extract key information including tech stack, structure, dependencies, and README. Results can be saved to the knowledge base.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path of the project directory to scan",
          },
          save: {
            type: "boolean",
            description: "Whether to auto-save scan results to knowledge base (default: false)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取指定路径的文件内容。支持 offset 和 limit 参数控制读取范围。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件绝对路径" },
          offset: { type: "number", description: "起始行号（从0开始，可选）" },
          limit: { type: "number", description: "最大读取行数（默认100，可选）" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_search",
      description: "在指定目录中搜索匹配正则表达式的文件内容。",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "正则表达式模式" },
          path: { type: "string", description: "搜索目录路径" },
          include: { type: "string", description: "文件名过滤模式（如 *.ts），可选" },
          max_results: { type: "number", description: "最大结果数（默认20）" },
        },
        required: ["pattern", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_script",
      description: "执行 Python 或 Bun 脚本（只读操作，如数据分析、文件处理、格式转换）。脚本在沙盒中执行，有 30 秒超时限制。",
      parameters: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: ["python", "bun"],
            description: "脚本语言：python 或 bun",
          },
          code: {
            type: "string",
            description: "要执行的脚本代码",
          },
        },
        required: ["language", "code"],
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
      const lines = doc.content.split("\n")
      const content = lines.length > 200
        ? lines.slice(0, 200).join("\n") + `\n\n...(文档较长，共${lines.length}行，仅显示前200行。可用 read_file("${meta.file_path}") 读取完整文件)`
        : doc.content
      return `## ${meta.title ?? id}\nTags: ${tags} | Keywords: ${keywords}\nIntent: ${meta.intent ?? "N/A"}${related}\n\n${content}`
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
        related_files: Array.isArray(args.related_files) ? args.related_files as string[] : undefined,
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
    case "scan_project": {
      const projectPath = String(args.path ?? "")
      if (!projectPath) return "Project path is required."
      if (!existsSync(projectPath)) return `Directory not found: ${projectPath}`

      const shouldSave = args.save === true
      const results: string[] = []
      const projectName = projectPath.split("/").pop() || projectPath

      const pkgPath = join(projectPath, "package.json")
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(await Bun.file(pkgPath).text())
        results.push(`## package.json`)
        results.push(`Name: ${pkg.name || projectName}`)
        results.push(`Version: ${pkg.version || "N/A"}`)
        results.push(`Description: ${pkg.description || "N/A"}`)
        if (pkg.dependencies) results.push(`Dependencies: ${Object.keys(pkg.dependencies).join(", ")}`)
        if (pkg.devDependencies) results.push(`DevDependencies: ${Object.keys(pkg.devDependencies).join(", ")}`)
        if (pkg.scripts) results.push(`Scripts: ${Object.keys(pkg.scripts).join(", ")}`)
      }

      const readmePath = join(projectPath, "README.md")
      if (existsSync(readmePath)) {
        const readme = await Bun.file(readmePath).text()
        const lines = readme.split("\n").slice(0, 30)
        results.push(`\n## README.md (前30行)`)
        results.push(lines.join("\n"))
      }

      results.push(`\n## 目录结构`)
      try {
        const findOutput = await Bun.$`find ${projectPath} -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/build/*' | head -100`.text()
        results.push(findOutput)
      } catch {
        results.push("(无法获取目录结构)")
      }

      const configFiles = ["tsconfig.json", "vite.config.ts", "vite.config.js", "next.config.ts", "next.config.js", "nuxt.config.ts", "tailwind.config.ts", "tailwind.config.js", ".eslintrc.js", ".eslintrc.json"]
      for (const cf of configFiles) {
        const fp = join(projectPath, cf)
        if (existsSync(fp)) {
          const content = await Bun.file(fp).text()
          const lines = content.split("\n").slice(0, 20)
          results.push(`\n## ${cf}`)
          results.push(lines.join("\n"))
        }
      }

      const srcPath = join(projectPath, "src")
      if (existsSync(srcPath)) {
        try {
          const srcOutput = await Bun.$`find ${srcPath} -maxdepth 2 -type f -not -path '*/node_modules/*' | head -50`.text()
          results.push(`\n## src/ 文件结构`)
          results.push(srcOutput)
        } catch {}
      }

      const scanContent = results.join("\n")

      if (shouldSave) {
        const doc = writeDoc({
          title: `${projectName} 项目扫描报告`,
          tags: ["reference", "architecture"],
          keywords: [projectName, "项目扫描", "project-scan"],
          intent: `项目 ${projectName} 的自动扫描报告`,
          project_description: projectName,
          source_project: projectPath,
          source_worktree: "",
        }, scanContent)
        return `✅ 项目扫描完成并已存入知识库:\n  ID: ${doc.id}\n  Title: ${doc.title}\n\n${scanContent}`
      }

      return `📋 项目扫描结果 (${projectName}):\n\n${scanContent}\n\n💡 提示: 如需保存到知识库，可以让我用 kb_write 存储。`
    }
    case "read_file": {
      const p = String(args.path ?? "")
      if (!p) return "File path is required."
      if (p.includes("..")) return "安全限制：路径不允许包含 .."
      if (!existsSync(p)) return `File not found: ${p}`
      const offset = Number(args.offset) || 0
      const limit = Number(args.limit) || 100
      try {
        const content = readFileSync(p, "utf-8")
        const lines = content.split("\n")
        const sliced = lines.slice(offset, offset + limit)
        const header = offset > 0
          ? `(第 ${offset + 1}-${Math.min(offset + limit, lines.length)} 行，共 ${lines.length} 行)\n\n`
          : `(共 ${lines.length} 行，显示前 ${sliced.length} 行)\n\n`
        return header + sliced.map((l, i) => `${offset + i + 1}: ${l}`).join("\n")
      } catch (e) {
        return `Error reading file: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    case "grep_search": {
      const pattern = String(args.pattern ?? "")
      if (!pattern) return "Search pattern is required."
      const dir = String(args.path ?? ".")
      if (dir.includes("..")) return "安全限制：路径不允许包含 .."
      const include = args.include ? String(args.include) : "*"
      const maxResults = Number(args.max_results) || 20
      try {
        const cmd = `grep -rn --include='${include}' -E "${pattern.replace(/"/g, '\\"')}" "${dir}" 2>/dev/null | head -${maxResults}`
        const result = execSync(cmd, { encoding: "utf-8", timeout: 10000, maxBuffer: 512 * 1024 })
        if (!result.trim()) return `No matches found for pattern "${pattern}" in ${dir}`
        return result.trim()
      } catch (e: unknown) {
        const err = e as { status?: number; message?: string }
        if (err.status === 1) return `No matches found for pattern "${pattern}" in ${dir}`
        return `搜索失败: ${err.message || String(e)}`
      }
    }
    case "run_script": {
      const language = String((args as { language: string; code: string }).language ?? "")
      const code = String((args as { language: string; code: string }).code ?? "")
      if (!language || !code) return "language and code are required."

      const forbidden = /writeFile|writeSync|mkdir|rmdir|unlink|rename|chmod|fork|exec\s*\(|spawn|child_process/
      if (forbidden.test(code)) return "安全限制：脚本不允许执行写操作或子进程操作"

      try {
        if (language === "python") {
          const tmpFile = join(tmpdir(), `kb-script-${Date.now()}.py`)
          writeFileSync(tmpFile, code, "utf-8")
          try {
            const result = execSync(`timeout 30 python3 "${tmpFile}" 2>&1`, { encoding: "utf-8", timeout: 35000, maxBuffer: 1024 * 1024 })
            return result.slice(0, 5000) || "(脚本执行成功，无输出)"
          } finally {
            unlinkSync(tmpFile)
          }
        } else {
          const tmpFile = join(tmpdir(), `kb-script-${Date.now()}.ts`)
          writeFileSync(tmpFile, code, "utf-8")
          try {
            const result = execSync(`timeout 30 bun run "${tmpFile}" 2>&1`, { encoding: "utf-8", timeout: 35000, maxBuffer: 1024 * 1024 })
            return result.slice(0, 5000) || "(脚本执行成功，无输出)"
          } finally {
            unlinkSync(tmpFile)
          }
        }
      } catch (e: unknown) {
        const err = e as { stdout?: string; stderr?: string; message?: string }
        const output = err.stdout || err.stderr || err.message || String(e)
        return `脚本执行错误: ${output.slice(0, 2000)}`
      }
    }
    default:
      return `Unknown tool: ${name}`
  }
}
