import { readFileSync, existsSync } from "node:fs"
import { readdirSync, statSync } from "node:fs"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { writeDoc, readDoc, searchDocs, listDocs, deleteDoc, getOutline, updateOutline, slugify, searchDocsSemantic, searchDocsCombined, listAllOutlines, rebuildAllVectors, getAllKeywords, listRecentDocs, recordMiss, resolveMiss, getMissStats } from "../storage/index.js"
import { kbAskPipeline } from "../search/kb-ask-pipeline.js"
import { mcpStats } from "../statistics/index.js"
import { loadConfig } from "../config.js"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("mcp:register-tools")
function scanDir(base: string, prefix: string, depth: number): string {
  if (depth <= 0) return `${prefix}/...`
  const dir = prefix ? `${base}/${prefix}` : base
  try {
    const items = readdirSync(dir).sort()
    const lines: string[] = []
    const skip = new Set([".git", "node_modules", "dist", ".turbo", ".next", "__pycache__", "target", "vendor"])
    for (const item of items) {
      if (item.startsWith(".") || skip.has(item)) continue
      const fullPath = prefix ? `${prefix}/${item}` : item
      try {
        const stat = statSync(`${base}/${fullPath}`)
        if (stat.isDirectory()) {
          lines.push(`${fullPath}/`)
          if (depth > 1) {
            const sub = scanDir(base, fullPath, depth - 1)
            if (sub) lines.push(...sub.split("\n").map(l => `  ${l}`))
          }
        } else {
          lines.push(fullPath)
        }
      } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
    }
    return lines.join("\n")
  } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)); return "" }
}

async function readKeyFiles(base: string, maxFiles: number): Promise<string> {
  const priorityFiles = [
    "README.md", "readme.md",
    "package.json", "Cargo.toml", "go.mod", "pyproject.toml",
    "tsconfig.json",
    "src/index.ts", "src/index.js", "src/main.ts", "src/main.js",
    "lib/index.ts", "lib/index.js",
    "index.ts", "index.js", "main.ts", "main.js",
  ]
  const sections: string[] = []
  let count = 0
  for (const pf of priorityFiles) {
    if (count >= maxFiles) break
    try {
      const content = await Bun.file(`${base}/${pf}`).text()
      if (content) {
        sections.push(`## ${pf}\n\n\`\`\`\n${content.slice(0, 2000)}${content.length > 2000 ? "\n... truncated" : ""}\n\`\`\``)
        count++
      }
    } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
  }
  return sections.join("\n\n")
}

export function registerTools(server: McpServer) {
  const origTool = server.tool.bind(server)
  const wrappedTool = (...args: Parameters<typeof server.tool>) => {
    const last = args[args.length - 1]
    if (typeof last === "function") {
      const toolName = typeof args[0] === "string" ? args[0] : "unknown"
      args[args.length - 1] = async function(this: unknown, ...innerArgs: unknown[]) {
        const t0 = Date.now()
        try {
          const result = await (last as (...a: unknown[]) => Promise<unknown>)(...innerArgs)
          mcpStats.recordToolCall(toolName, {}, Date.now() - t0, false)
          return result
        } catch (err) {
          mcpStats.recordToolCall(toolName, {}, Date.now() - t0, true)
          throw err
        }
      } as typeof last
    }
    return origTool(...args)
  }
  server.tool = wrappedTool as typeof server.tool
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

  server.tool(
    "file_read",
    "通过绝对路径读取文件内容，支持 offset 和 limit 参数。适用于远程访问服务器文件系统。",
    {
      path: z.string().describe("文件绝对路径"),
      offset: z.number().optional().default(0).describe("起始行号（默认 0）"),
      limit: z.number().optional().default(2000).describe("读取行数（默认 2000）"),
    },
    async (args) => {
      if (!existsSync(args.path)) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: false, error: "文件不存在" }) }] }
      }
      try {
        const raw = readFileSync(args.path, "utf-8")
        const lines = raw.split("\n")
        const totalLines = lines.length

        const start = Math.max(0, args.offset)
        const end = Math.min(totalLines, start + args.limit)
        const contentLines = lines.slice(start, end)

        const content = contentLines
          .map((line, i) => `${start + i + 1}: ${line}`)
          .join("\n")

        const truncated = end < totalLines

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              path: args.path,
              exists: true,
              content,
              total_lines: totalLines,
              truncated,
              offset: start,
              limit: args.limit,
              ...(truncated ? { hint: `文件共${totalLines}行，当前显示第${start + 1}-${end}行` } : {}),
            }, null, 2),
          }],
        }
      } catch (e: unknown) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: true, error: e instanceof Error ? e.message : String(e) }) }] }
      }
    },
  )

  server.tool(
    "file_grep",
    "在指定文件中搜索文本内容。支持正则表达式和普通文本搜索。",
    {
      path: z.string().describe("文件绝对路径"),
      pattern: z.string().describe("搜索文本或正则表达式"),
      case_sensitive: z.boolean().optional().default(false).describe("是否区分大小写"),
      regex: z.boolean().optional().default(true).describe("是否使用正则表达式"),
    },
    async (args) => {
      if (!existsSync(args.path)) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: false, error: "文件不存在" }) }] }
      }
      try {
        const raw = readFileSync(args.path, "utf-8")
        const lines = raw.split("\n")

        let regex: RegExp
        try {
          const flags = args.case_sensitive ? "g" : "gi"
          regex = new RegExp(args.pattern, flags)
        } catch (e: unknown) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "正则表达式无效", detail: e instanceof Error ? e.message : String(e) }),
            }],
          }
        }

        const matches: Array<{ line: number; content: string; matched_text: string }> = []

        lines.forEach((line, index) => {
          const match = line.match(regex)
          if (match) {
            matches.push({
              line: index + 1,
              content: line,
              matched_text: match[0],
            })
          }
        })

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              path: args.path,
              exists: true,
              matches,
              total_matches: matches.length,
            }, null, 2),
          }],
        }
      } catch (e: unknown) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: true, error: e instanceof Error ? e.message : String(e) }) }] }
      }
    },
  )

  server.tool(
    "file_exists",
    "检查文件或目录是否存在。用于验证路径有效性。",
    {
      path: z.string().describe("文件/目录绝对路径"),
    },
    async (args) => {
      const exists = existsSync(args.path)
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            path: args.path,
            exists,
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

  server.tool(
    "kb_ingest_url",
    "摄入 URL 内容到知识库。Agent 用 web-reader / xbrowser 抓取后调用此工具存储。存储后自动 resolve miss。",
    {
      url: z.string().describe("来源 URL"),
      title: z.string().describe("文档标题"),
      content: z.string().describe("页面内容（Markdown 格式）"),
      tags: z.array(z.string()).optional().default(["reference", "auto-ingested"]).describe("标签"),
      keywords: z.array(z.string()).optional().describe("关键词（不填则从标题自动提取）"),
    },
    async (args) => {
      const autoKeywords = args.keywords?.length
        ? args.keywords
        : args.title.split(/[\s,，、]+/).filter(w => w.length > 1).slice(0, 8)

      const doc = writeDoc(
        {
          title: args.title,
          tags: args.tags,
          keywords: autoKeywords,
          intent: `Auto-ingested from ${args.url}`,
          project_description: "kb_ask pipeline",
        },
        args.content,
      )

      resolveMiss(args.title)
      if (args.title !== args.url) {
        resolveMiss(args.url)
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            saved: true,
            id: doc.id,
            title: doc.title,
            url: args.url,
            miss_resolved: true,
            hint: `✅ 已存储（id: ${doc.id}）。下次搜索将直接命中。`,
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_ingest_repo",
    "克隆 GitHub 仓库到临时目录，分析目录结构和关键文件，生成知识文档存入知识库。",
    {
      repo: z.string().describe("GitHub 仓库（owner/repo 格式，如 oven-sh/bun）"),
      max_files: z.number().optional().default(20).describe("最多读取文件数"),
    },
    async (args) => {
      const tmpDir = `/tmp/kb-repo-${Date.now()}`
      let cloneOk = false
      try {
        // Strategy 1: ZIP download via curl (curl respects proxy env vars automatically)
        let repoDir = tmpDir
        try {
          const zipUrl = `https://github.com/${args.repo}/archive/refs/heads/main.zip`
          const zipPath = `${tmpDir}.zip`
          const curlProc = Bun.spawn([
            "curl", "-fsSL", "--connect-timeout", "15", "--max-time", "30",
            "-o", zipPath, zipUrl,
          ], {
            stdout: "pipe", stderr: "pipe",
            env: { ...process.env },
          })
          const curlExit = await Promise.race([
            curlProc.exited,
            new Promise<number>((_, reject) => setTimeout(() => { curlProc.kill(); reject(new Error("curl timeout")) }, 35000)),
          ])
          if (curlExit === 0) {
            // Extract zip into tmpDir
            await Bun.spawn(["unzip", "-q", zipPath, "-d", tmpDir], {
              stdout: "pipe", stderr: "pipe",
              env: { ...process.env },
            }).exited
            // unzip creates a subdirectory like zod-main/, use that as repo root
            const entries = readdirSync(tmpDir).sort()
            if (entries.length === 1) {
              const subDir = `${tmpDir}/${entries[0]}`
              const stat = statSync(subDir)
              if (stat.isDirectory()) {
                repoDir = subDir
              }
            }
            cloneOk = true
          }
        } catch {
          // ZIP failed, try git clone
        }

        // Strategy 2: git clone fallback
        if (!cloneOk) {
          try {
            const proc = Bun.spawn(["git", "clone", "--depth=1", `https://github.com/${args.repo}.git`, tmpDir], {
              stdout: "pipe",
              stderr: "pipe",
              env: { ...process.env },
            })
            const exitCode = await Promise.race([
              proc.exited,
              new Promise<number>((_, reject) => setTimeout(() => { proc.kill(); reject(new Error("timeout")) }, 45000)),
            ])
            if (exitCode === 0) {
              cloneOk = true
              repoDir = tmpDir
            }
          } catch {
            // git clone also failed
          }
        }

        if (!cloneOk) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "下载失败（ZIP 和 git clone 均失败），请检查网络/代理设置", repo: args.repo }),
            }],
          }
        }

        const structure = scanDir(repoDir, "", 3)
        const keyFiles = await readKeyFiles(repoDir, args.max_files)
        const filesRead = keyFiles ? keyFiles.split("## ").length - 1 : 0

        const docContent = `# ${args.repo} 项目分析

## 目录结构

\`\`\`
${structure}
\`\`\`

## 关键文件

${keyFiles}

---
> Auto-generated by kb_ingest_repo
> Source: https://github.com/${args.repo}
`

        const doc = writeDoc(
          {
            title: `${args.repo} 项目分析`,
            tags: ["architecture", "reference", "auto-ingested"],
            keywords: args.repo.split(/[\/\-_.]/).filter(w => w.length > 1),
            intent: `${args.repo} 仓库的结构分析和关键文件内容`,
            project_description: "kb_ingest_repo auto-generated",
          },
          docContent,
        )

        resolveMiss(args.repo)

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              saved: true,
              id: doc.id,
              title: doc.title,
              repo: args.repo,
              files_read: filesRead,
              hint: `✅ 已分析并存储 ${args.repo}`,
            }, null, 2),
          }],
        }
      } catch (e: unknown) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: e instanceof Error ? e.message : String(e), repo: args.repo }),
          }],
        }
      } finally {
        try { Bun.spawn(["rm", "-rf", tmpDir], { stdout: "pipe", stderr: "pipe" }) } catch (e) { /* cleanup: ignore */ }
        try { Bun.spawn(["rm", "-f", `${tmpDir}.zip`], { stdout: "pipe", stderr: "pipe" }) } catch (e) { /* cleanup: ignore */ }
      }
    },
  )

  server.tool(
    "kb_stale_check",
    "检查知识库中 related_files 引用的文件是否已变更，返回过期文档列表。",
    {},
    async () => {
      const idx = readFileSync(`${process.env.KB_DIR || `${process.env.HOME}/.knowledge`}/index.json`, "utf-8")
      interface IndexDoc { id: string; title: string; related_files?: string[]; updated_at?: number }
      const docs = JSON.parse(idx).documents as Record<string, IndexDoc>
      const stale: Array<{ id: string; title: string; file: string; doc_updated: number; file_modified: number }> = []

      for (const doc of Object.values(docs)) {
        if (!doc.related_files?.length) continue
        for (const f of doc.related_files) {
          try {
            const stat = await Bun.file(f).stat()
            if (stat && stat.mtime && doc.updated_at && stat.mtime.getTime() > doc.updated_at) {
              stale.push({
                id: doc.id,
                title: doc.title,
                file: f,
                doc_updated: doc.updated_at,
                file_modified: stat.mtime.getTime(),
              })
            }
          } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_checked: Object.values(docs).filter(d => d.related_files?.length).length,
            stale_count: stale.length,
            stale_docs: stale.slice(0, 20),
            hint: stale.length > 0
              ? `发现 ${stale.length} 个过期文档，建议用 file_read 重新读取并 kb_update 更新。`
              : "✅ 所有关联文件均未过期。",
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_auto_link",
    "自动发现知识库中语义相关的文档，返回关联建议。",
    {
      doc_id: z.string().optional().describe("指定文档 ID（不指定则分析最近 10 篇）"),
      threshold: z.number().optional().default(0.7).describe("语义相似度阈值（0-1）"),
    },
    async (args) => {
      const allDocs = listDocs()
      const targetDocs = args.doc_id
        ? allDocs.filter(d => d.id === args.doc_id)
        : allDocs.sort((a, b) => (b.updated_at || b.created_at) - (a.updated_at || a.created_at)).slice(0, 10)

      const links: Array<{ source: string; source_title: string; target: string; target_title: string; score: number }> = []

      for (const doc of targetDocs) {
        try {
          const query = `${doc.title} ${doc.keywords.slice(0, 5).join(" ")}`
          const results = await searchDocsSemantic(query, 5)
          for (const r of results) {
            if (r.id === doc.id) continue
            if (r.score >= args.threshold) {
              links.push({
                source: doc.id,
                source_title: doc.title,
                target: r.id,
                target_title: r.title,
                score: Math.round(r.score * 1000) / 1000,
              })
            }
          }
        } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            analyzed: targetDocs.length,
            links_found: links.length,
            links: links.slice(0, 20),
            hint: links.length > 0
              ? `发现 ${links.length} 对关联文档。可考虑在文档中互相引用。`
              : "未发现高相似度关联。",
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_suggest",
    "基于 miss 日志分析，推荐应该预抓取的知识主题。",
    {
      limit: z.number().optional().default(10).describe("返回建议数量"),
    },
    async (args) => {
      const stats = getMissStats(args.limit)
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_unresolved_misses: stats.unresolved.length,
            suggested_topics: stats.top_missed.map(m => ({
              query: m.query,
              miss_count: m.count,
              urgency: m.count >= 3 ? "high" : m.count >= 2 ? "medium" : "low",
              suggested_action: `web-search-prime(query="${m.query}") → web-reader → kb_ingest_url`,
            })),
            hint: stats.top_missed.length > 0
              ? `有 ${stats.top_missed.filter(m => m.count >= 2).length} 个高频 miss 话题建议优先处理。`
              : "暂无高频 miss 话题。",
          }, null, 2),
        }],
      }
    },
  )

  server.tool(
    "kb_research",
    "深度研究一个主题：自动搜索、深读 URL、分析 sitemap/GitHub、生成结构化研究报告。适用于知识库中没有答案、需要联网深入研究的场景。返回结构化研究报告。",
    {
      query: z.string().describe("研究主题或问题"),
      mode: z.enum(["quick", "standard", "deep"]).optional().default("standard").describe("研究模式：quick(快速)、standard(标准)、deep(深度)"),
    },
    async (args) => {
      const config = loadConfig()
      if (!config.searchPipeline?.enabled) {
        return {
          content: [{ type: "text" as const, text: "Error: Search pipeline not enabled in config. Enable it to use kb_research." }],
          isError: true,
        }
      }

      const { ResearchAgent } = await import("../research/research-agent.js")
      const agent = new ResearchAgent(
        { query: args.query, mode: args.mode },
        () => {},
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

      return {
        content: [{ type: "text" as const, text: `# 研究报告: ${result.query}\n\n${result.summary}\n\n---\n📊 ${meta}` }],
      }
    },
  )
}
