import { searchDocs, readDoc, listDocs, writeDoc, getOutline } from "../storage/index.js"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { expandQuery } from "./query-expander.js"
import { launchBrowserForScrape, cleanupBrowser } from "./browser-launcher.js"
import { loadConfig, getDataDir } from "../config.js"
import { createLogger } from "../utils/logger.js"
import { executeUrlFetch } from "./tools/url-fetch.js"
import { executeGitClone } from "./tools/git-clone.js"
import { executeScanProject } from "./tools/scan-project.js"
import { executeRunScript } from "./tools/run-script.js"
import { executeReadFile, executeGrepSearch } from "./tools/file-search.js"

const logger = createLogger("chat:tools")

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
    case "scan_project": {
      return executeScanProject(args)
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
        } catch (e) {
          logger.warn(e instanceof Error ? e.message : String(e))
        }

        const filtered = [...new Set(links)]
          .filter(link => {
            try {
              const u = new URL(link, url)
              return u.hostname === baseHost || u.hostname.endsWith(`.${baseHost}`)
            } catch (e) {
              logger.warn(e instanceof Error ? e.message : String(e))
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
      } catch (e) {
        logger.warn(e instanceof Error ? e.message : String(e))
      }

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
        } catch (e) {
          logger.warn(e instanceof Error ? e.message : String(e))
        }
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
      return executeUrlFetch(args)
    }
    case "git_clone": {
      return executeGitClone(args)
    }
    case "read_file": {
      return executeReadFile(args)
    }
    case "grep_search": {
      return executeGrepSearch(args)
    }
    case "run_script": {
      return executeRunScript(args)
    }
    case "kb_research": {
      const query = String(args.query || "")
      if (!query) return "query is required."

      const config = loadConfig()
      if (!config.searchPipeline?.enabled) {
        return `Error: Search pipeline not enabled. Enable searchPipeline in ${join(getDataDir(), "config.json")} to use kb_research.`
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

            writeDoc(
              {
                title: `研究: ${query}`,
                tags: ["research", "auto-saved", result.mode, "web-ingested"],
                keywords: allKw,
                intent: `Auto-research for "${query}" (${result.mode}, Q:${result.finalQualityScore}/C:${result.finalCoverageScore})`,
                project_description: "Research results",
              },
              fullSummary,
            )
            saveNote = "\n\n✅ 已自动存入知识库"
          } catch (e) {
            logger.error("Auto-save failed:", e instanceof Error ? e.message : e)
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
