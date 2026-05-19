import { searchDocs, readDoc, listDocs, writeDoc, getOutline } from "../storage/index.js"
import { existsSync, readFileSync, writeFileSync, unlinkSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execSync } from "node:child_process"
import { expandQuery } from "./query-expander.js"
import { launchBrowserForScrape, cleanupBrowser } from "./browser-launcher.js"
import { loadConfig } from "../config.js"

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
      description: "Save a knowledge document to the knowledge base. ALL fields except id are required. Use when user wants to save, store, or record information, summaries, best practices, or any useful knowledge for future reference.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "文档ID（可选，传入则更新，不传则新建）" },
          title: { type: "string", description: "文档标题（必填）" },
          content: { type: "string", description: "Markdown 正文（必填）" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "标签分类（必填，如 [\"reference\", \"architecture\"]）",
          },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "搜索关键词（必填，如 [\"retry\", \"timeout\"]）",
          },
          intent: { type: "string", description: "文档用途说明（必填）" },
          project_description: { type: "string", description: "项目简介（必填）" },
          project_path: { type: "string", description: "项目磁盘绝对路径（必填，如 /Users/xuyingzhou/code/project）" },
          related_projects: {
            type: "array",
            items: { type: "string" },
            description: "关联项目路径或名称（必填）",
          },
          related_files: {
            type: "array",
            items: { type: "string" },
            description: "关联源码文件路径（必填，如 [\"src/index.ts\", \"src/chat/api.ts\"]）",
          },
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
      name: "browser_scrape",
      description: "用浏览器抓取页面内容（支持 SPA/JS 渲染页面）。比 url_fetch 更强大，能处理 Vue/React 等单页应用。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "目标 URL" },
          format: { type: "string", description: "输出格式: markdown|html|text (默认 markdown)" },
          selector: { type: "string", description: "等待指定 CSS 选择器出现后再抓取" },
          timeout: { type: "number", description: "超时毫秒 (默认 15000)" },
          max_length: { type: "number", description: "返回内容最大字符数（默认 10000）" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_map",
      description: "发现网站的所有 URL 链接。返回站点地图。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "目标网站 URL" },
          search: { type: "string", description: "只返回包含此字符串的 URL" },
          limit: { type: "number", description: "最大返回数量 (默认 100)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_crawl",
      description: "爬取网站多个页面（广度优先）。适合文档站、博客等结构化站点。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "起始 URL" },
          limit: { type: "number", description: "最大爬取页数 (默认 10)" },
          max_depth: { type: "number", description: "最大深度 (默认 2)" },
          include_paths: { type: "string", description: "只爬包含这些路径的页面 (如 /docs/)" },
          max_length: { type: "number", description: "总内容最大字符数 (默认 30000)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "url_fetch",
      description: "访问指定 URL 并返回页面内容（curl 方式，不支持 JS 渲染）。SPA 页面请使用 browser_scrape。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "要访问的 URL" },
          max_length: { type: "number", description: "返回内容最大字符数（默认 10000）" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_clone",
      description: "克隆 Git 仓库到临时目录，返回本地路径。支持 GitHub/GitLab 等仓库 URL。浅克隆（depth=1）节省时间。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Git 仓库 URL（https:// 或 git://）" },
          branch: { type: "string", description: "分支名（可选，默认 main）" },
          depth: { type: "number", description: "克隆深度（默认 1）" },
        },
        required: ["url"],
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
  {
      type: "function",
      function: {
        name: "kb_research",
        description: "对指定主题进行深度研究。多源搜索 → URL 深读 → sitemap/github 发现 → 质量评估 → 结构化总结。返回研究报告（含参考资料和质量评分）。结果自动存入知识库，下次同类问题可直接命中，一次研究可反复复用。推荐用于知识库未覆盖的主题。",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "研究主题或问题",
            },
            mode: {
              type: "string",
              description: '研究模式 - "quick"(快速搜索)、"standard"(标准研究)、"deep"(深度研究)',
              default: "standard",
            },
          },
          required: ["query"],
        },
      },
    },
  ]


function buildTree(lines: string[]): string {
  const root: Record<string, string[]> = {}
  for (const line of lines) {
    const clean = line.replace(/^\.\//, "")
    if (!clean) continue
    const parts = clean.split("/")
    const dir = parts.slice(0, -1).join("/")
    const file = parts[parts.length - 1]
    if (!root[dir]) root[dir] = []
    root[dir].push(file)
  }

  const result: string[] = []
  const sortedDirs = Object.keys(root).sort()

  for (const dir of sortedDirs) {
    if (!dir) {
      const files = root[""].filter(f => !f.includes(".") || f === ".").sort()
      result.push(...files.map(f => f))
      continue
    }
    const indent = dir.split("/").map(() => "│   ").join("").slice(0, -4) + "├── "
    const dirName = dir.split("/").pop() || dir
    result.push(`${indent}${dirName}/`)
    const items = (root[dir] || []).sort()
    for (const item of items) {
      const itemIndent = dir.split("/").map(() => "│   ").join("")
      result.push(`${itemIndent}├── ${item}`)
    }
  }

  return result.join("\n")
}

export type ToolProgressCallback = (progress: { step: string; status: string; output?: unknown }) => void

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  onProgress?: ToolProgressCallback,
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

      results.push(`\n## 目录结构（树状）`)
      try {
        const treeOutput = execSync(
          `cd "${projectPath}" && find . -maxdepth 4 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/.next/*' -not -path '*/build/*' -not -path '*/coverage/*' | sort | head -150`,
          { encoding: "utf-8", timeout: 10000 }
        )
        const lines = treeOutput.trim().split("\n")
        const tree = buildTree(lines)
        results.push(`${projectName}/\n${tree}`)
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
          project_path: projectPath,
          source_project: projectPath,
          source_worktree: "",
          related_projects: [],
          related_files: [],
        }, scanContent)
        return `✅ 项目扫描完成并已存入知识库:\n  ID: ${doc.id}\n  Title: ${doc.title}\n\n${scanContent}`
      }

      return `📋 项目扫描结果 (${projectName}):\n\n${scanContent}\n\n💡 提示: 如需保存到知识库，可以让我用 kb_write 存储。`
    }
    case "browser_scrape": {
      const { url, format = "markdown", selector, max_length = 10000 } = args as { url: string; format?: string; selector?: string; timeout?: number; max_length?: number }
      const config = loadConfig()
      const timeout = Number(args.timeout) || config.browser.defaultTimeout

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return "URL 必须以 http:// 或 https:// 开头"
      }

      try {
        const { session } = await launchBrowserForScrape(url)
        const page = session.page

        if (selector) {
          await page.waitForSelector(selector, { timeout })
        }

        let content: string
        if (format === "html") {
          content = await page.content()
        } else if (format === "text") {
          content = await page.innerText("body")
        } else {
          const html = await page.content()
          content = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<\/h[1-6]>/gi, "\n")
            .replace(/<\/li>/gi, "\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        }

        return content.slice(0, max_length) || "(无内容)"
      } catch (e: unknown) {
        return `浏览器抓取失败: ${e instanceof Error ? e.message : String(e)}`
      } finally {
        await cleanupBrowser()
      }
    }
    case "browser_map": {
      const { url, search, limit = 100 } = args as { url: string; search?: string; limit?: number }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return "URL 必须以 http:// 或 https:// 开头"
      }

      try {
        const { session } = await launchBrowserForScrape(url)
        const page = session.page

        const links: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]")).map(a => (a as HTMLAnchorElement).href)
        )

        let baseHost = ""
        try {
          baseHost = new URL(url).hostname
        } catch {}

        const filtered = [...new Set(links)]
          .filter(link => {
            try {
              const u = new URL(link, url)
              return u.hostname === baseHost || u.hostname.endsWith(`.${baseHost}`)
            } catch {
              return false
            }
          })
          .filter(link => !search || link.includes(search))
          .slice(0, limit)

        return JSON.stringify(filtered, null, 2)
      } catch (e: unknown) {
        return `浏览器站点地图失败: ${e instanceof Error ? e.message : String(e)}`
      } finally {
        await cleanupBrowser()
      }
    }
    case "browser_crawl": {
      const { url, limit = 10, max_depth = 2, include_paths, max_length = 30000 } = args as {
        url: string; limit?: number; max_depth?: number; include_paths?: string; max_length?: number
      }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return "URL 必须以 http:// 或 https:// 开头"
      }

      let baseHost = ""
      try {
        baseHost = new URL(url).hostname
      } catch {}

      const visited = new Set<string>()
      const results: string[] = []
      const queue: { url: string; depth: number }[] = [{ url, depth: 0 }]

      let browserSession: Awaited<ReturnType<typeof launchBrowserForScrape>> | null = null
      try {
        while (queue.length > 0 && results.length < limit) {
          const item = queue.shift()!
          if (visited.has(item.url) || item.depth > max_depth) continue
          visited.add(item.url)

          if (include_paths && !item.url.includes(include_paths)) continue

          let content: string
          let links: string[] = []
          try {
            if (!browserSession) {
              browserSession = await launchBrowserForScrape(item.url)
            }
            const page = browserSession.session.page
            await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 15000 })

            const html = await page.content()
            content = html
              .replace(/<script[\s\S]*?<\/script>/gi, "")
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<\/p>/gi, "\n")
              .replace(/<\/h[1-6]>/gi, "\n")
              .replace(/<\/li>/gi, "\n")
              .replace(/<\/div>/gi, "\n")
              .replace(/<[^>]+>/g, "")
              .replace(/&nbsp;/g, " ")
              .replace(/&amp;/g, "&")
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/\n{3,}/g, "\n\n")
              .trim()

            links = await page.evaluate(() =>
              Array.from(document.querySelectorAll("a[href]")).map(a => (a as HTMLAnchorElement).href)
            )
          } catch (e: unknown) {
            content = `(抓取失败: ${e instanceof Error ? e.message : String(e)})`
          }

          results.push(`## Page: ${item.url}\n${content}\n`)

          for (const link of links) {
            try {
              const u = new URL(link, url)
              if ((u.hostname === baseHost || u.hostname.endsWith(`.${baseHost}`)) && !visited.has(u.href)) {
                queue.push({ url: u.href, depth: item.depth + 1 })
              }
            } catch {}
          }
        }
      } catch (e: unknown) {
        results.push(`\n爬取中断: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (browserSession) await cleanupBrowser()
      }

      const combined = results.join("\n")
      return combined.slice(0, max_length)
    }
    case "url_fetch": {
      const { url, max_length = 10000 } = args as { url: string; max_length?: number }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return "URL 必须以 http:// 或 https:// 开头"
      }

      try {
        const result = execSync(`curl -sL --max-time 15 "${url}"`, { encoding: "utf-8", timeout: 20000, maxBuffer: 2 * 1024 * 1024 })

        let text = result
        if (text.includes("<html") || text.includes("<!DOCTYPE")) {
          text = text
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<\/h[1-6]>/gi, "\n")
            .replace(/<\/li>/gi, "\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/\n{3,}/g, "\n\n")
            .trim()
        }

        return text.slice(0, max_length) || "(无内容)"
      } catch (e: unknown) {
        return `访问失败: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    case "git_clone": {
      const { url, branch, depth = 1 } = args as { url: string; branch?: string; depth?: number }

      if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("git://")) {
        return "URL 必须以 http://, https:// 或 git:// 开头"
      }

      const repoName = url.split("/").pop()?.replace(".git", "") || "repo"
      const targetDir = join(tmpdir(), `kb-clone-${repoName}-${Date.now()}`)

      try {
        let cmd = `git clone --depth=${depth}`
        if (branch) cmd += ` --branch ${branch}`
        cmd += ` "${url}" "${targetDir}"`

        execSync(cmd, { encoding: "utf-8", timeout: 120000 })

        const structure = execSync(
          `cd "${targetDir}" && find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' | head -100`,
          { encoding: "utf-8" }
        )

        return JSON.stringify({
          path: targetDir,
          message: `已克隆到 ${targetDir}`,
          structure: structure.trim(),
        })
      } catch (e: unknown) {
        try { rmSync(targetDir, { recursive: true }) } catch {}
        return `克隆失败: ${e instanceof Error ? e.message : String(e)}`
      }
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
    case "kb_research": {
      const query = String(args.query || "")
      if (!query) return "query is required."

      const config = loadConfig()
      if (!config.searchPipeline?.enabled) {
        return "Error: Search pipeline not enabled. Enable searchPipeline in ~/.kb-chat/config.json to use kb_research."
      }

      try {
        const { ResearchAgent } = await import("../research/research-agent.js")
        const mode = (args.mode as "quick" | "standard" | "deep") || "standard"
        const agent = new ResearchAgent(
          { query, mode },
          (p) => { if (onProgress) onProgress(p) },
        )

        const result = await agent.run()
        const dr = result.deepReadResults || []
        const drSuccess = dr.filter(r => r.success).length

        const meta = [
          `研究模式: ${result.mode}`,
          `总步骤: ${result.totalSteps}`,
          `深读: ${drSuccess}/${dr.length} URLs`,
          `质量/覆盖: ${result.finalQualityScore}/${result.finalCoverageScore}`,
          `耗时: ${(result.durationMs / 1000).toFixed(1)}s`,
        ].join(" | ")

        // Auto-save to knowledge base
        let saveNote = ""
        if (result.summary && result.summary.length >= 200) {
          try {
            const { writeDoc } = await import("../storage/index.js")
            const searchTitles = (result.searchResults || [])
              .flatMap(r => r.title.split(/[\s|\-–—:：,，.·/\\()（）\[\]]+/))
              .filter(w => w.length > 2 && w.length < 30)
              .map(w => w.toLowerCase())
            const queryWords = query.split(/[\s,，]+/).filter(w => w.length > 1)
            const allKw = [...new Set([...queryWords, ...searchTitles.slice(0, 8)])].slice(0, 10)

            const sources = (result.sources || []).map(s => `- [${s.title}](${s.url})`).slice(0, 10).join("\n")
            const fullSummary = result.summary + (sources ? `\n\n## 参考资料\n${sources}` : "")

            writeDoc({
              title: `研究: ${query}`,
              content: fullSummary,
              tags: ["research", "auto-saved", result.mode, "web-ingested"],
              keywords: allKw,
              intent: `Auto-research for "${query}" (${result.mode}, Q:${result.finalQualityScore}/C:${result.finalCoverageScore})`,
              project_description: "Research results",
            }, undefined)
            saveNote = "\n\n✅ 已自动存入知识库"
          } catch (e) {
            console.error("[kb_research] Auto-save failed:", e instanceof Error ? e.message : e)
            saveNote = "\n\n⚠️ 自动存入知识库失败"
          }
        }

        return `# 研究报告: ${result.query}\n\n${result.summary}\n\n---\n📊 ${meta}${saveNote}`
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        return `研究失败: ${msg}`
      }
    }
    default:
      return `Unknown tool: ${name}`
  }
}
