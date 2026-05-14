#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { randomUUID } from "node:crypto"
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { join, extname } from "node:path"
import { writeDoc, readDoc, searchDocs, listDocs, deleteDoc, getOutline, updateOutline, slugify, searchDocsSemantic, searchDocsCombined, listAllOutlines, rebuildAllVectors, getAllKeywords, listRecentDocs, recordMiss, resolveMiss, getMissStats } from "./storage/index.js"
import type { DocMeta } from "./storage/index.js"
import { getStorageStats, initDb } from "./search/vector-store.js"
import { handleChat } from "./chat/api-chat.js"
import { handleGetModels, handleSetModel } from "./chat/api-models.js"
import { handleListSessions, handleCreateSession, handleDeleteSession, handleGetMessages, handleRenameSession } from "./chat/api-sessions.js"
import { handleListFavorites, handleAddFavorite, handleDeleteFavorite } from "./chat/api-favorites.js"
import { handleListSessionFavorites, handleAddSessionFavorite, handleDeleteSessionFavorite } from "./chat/api-session-favorites.js"
import { handleShareSession } from "./chat/api-share.js"
import { handleScanSkills, handleGetSkillPaths, handleUpdateSkillPaths } from "./chat/api-skills.js"
import { handleBrowserDetect } from "./chat/api-browser.js"
import { loadConfig, saveConfig } from "./config.js"
import type { AppConfig } from "./config.js"

function scanDir(base: string, prefix: string, depth: number): string {
  if (depth <= 0) return `${prefix}/...`
  const dir = prefix ? `${base}/${prefix}` : base
  try {
    const items = Bun.readdirSync(dir).sort()
    const lines: string[] = []
    const skip = new Set([".git", "node_modules", "dist", ".turbo", ".next", "__pycache__", "target", "vendor"])
    for (const item of items) {
      if (item.startsWith(".") || skip.has(item)) continue
      const fullPath = prefix ? `${prefix}/${item}` : item
      try {
        const stat = Bun.statSync(`${base}/${fullPath}`)
        if (stat.isDirectory()) {
          lines.push(`${fullPath}/`)
          if (depth > 1) {
            const sub = scanDir(base, fullPath, depth - 1)
            if (sub) lines.push(...sub.split("\n").map(l => `  ${l}`))
          }
        } else {
          lines.push(fullPath)
        }
      } catch {}
    }
    return lines.join("\n")
  } catch {
    return ""
  }
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
    } catch {}
  }
  return sections.join("\n\n")
}

function registerTools(server: McpServer) {
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
      } catch (e: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: "语义搜索失败，可能正在下载模型", detail: e.message }),
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
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: true, error: e.message }) }] }
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
        } catch (e: any) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "正则表达式无效", detail: e.message }),
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
      } catch (e: any) {
        return { content: [{ type: "text", text: JSON.stringify({ path: args.path, exists: true, error: e.message }) }] }
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
    `智能查询：先搜知识库，没命中则返回 Miss Task 引导 Agent 用外部工具搜索后存储。
返回 { from_kb: boolean, sources: [...], content: "..." }`,
    {
      query: z.string().describe("自然语言查询"),
      max_web_results: z.number().optional().default(3).describe("联网搜索最大结果数（默认 3）"),
      auto_save: z.boolean().optional().default(true).describe("是否自动存入知识库（默认 true）"),
    },
    async (args) => {
      const kbResults = searchDocs(args.query, undefined, undefined, 3)
      const highScoreHits = kbResults.filter(r => r.score >= 40)

      if (highScoreHits.length > 0) {
        const best = highScoreHits[0]
        const full = readDoc(best.id, false)
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              from_kb: true,
              id: best.id,
              title: best.title,
              score: best.score,
              content: full ? full.content.slice(0, 4000) : best.snippet || best.intent,
              hint: "✅ 直接从知识库命中，无需联网搜索",
            }, null, 2),
          }],
        }
      }

      const miss = recordMiss(args.query)

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            from_kb: false,
            miss: true,
            query: args.query,
            miss_stats: { total_unresolved: miss.total_misses, recurring: miss.recurring },
            suggested_workflow: {
              step_1_search: `web-search-prime(query="${args.query}")`,
              step_2_read: "web-reader(url=top_results) — 抓取页面完整内容",
              step_3_store: "kb_ingest_url(url, title, content) — 存入知识库",
            },
            alternative_workflows: {
              github_repo: "zread(repo='owner/repo') → kb_ingest_url()",
              js_rendered_page: "agent-browser / xbrowser scrape(url) → kb_ingest_url()",
              local_project: "kb_ingest_repo(repo_url) → 自动克隆分析存储",
            },
            hint: miss.recurring
              ? `⚠️ 该查询已 miss ${miss.total_misses} 次，建议尽快搜索并存储。`
              : "知识库未命中。请使用 web-search-prime / web-reader 搜索后，通过 kb_ingest_url 存储。",
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
      try {
        const proc = Bun.spawn(["git", "clone", "--depth=1", `https://github.com/${args.repo}.git`, tmpDir], {
          stdout: "pipe",
          stderr: "pipe",
        })
        const exitCode = await proc.exited
        if (exitCode !== 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: "git clone 失败", repo: args.repo }),
            }],
          }
        }

        const structure = scanDir(tmpDir, "", 3)
        const keyFiles = await readKeyFiles(tmpDir, args.max_files)

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
              files_read: keyFiles.split("## ").length - 1,
              hint: `✅ 已分析并存储 ${args.repo}`,
            }, null, 2),
          }],
        }
      } catch (e: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: e.message, repo: args.repo }),
          }],
        }
      } finally {
        try {
          Bun.spawn(["rm", "-rf", tmpDir], { stdout: "pipe", stderr: "pipe" })
        } catch {}
      }
    },
  )

  server.tool(
    "kb_stale_check",
    "检查知识库中 related_files 引用的文件是否已变更，返回过期文档列表。",
    {},
    async () => {
      const idx = readFileSync(`${process.env.KB_DIR || `${process.env.HOME}/.knowledge`}/index.json`, "utf-8")
      const docs = JSON.parse(idx).documents as Record<string, any>
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
          } catch {}
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_checked: Object.values(docs).filter((d: any) => d.related_files?.length).length,
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
        } catch {}
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
}

function renderRecentHtml(
  results: { meta: DocMeta; content?: string; snippet: string }[],
  hours: number,
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  const fmtTime = (ms: number) => new Date(ms).toLocaleString("zh-CN", { hour12: false })
  const items = results.map(r => {
    const m = r.meta
    const tagsHtml = m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")
    return `<article class="card">
  <div class="card-header">
    <h2><a href="/api/doc/${esc(m.id)}">${esc(m.title)}</a></h2>
    <time>${fmtTime(m.created_at)}</time>
  </div>
  <p class="intent">${esc(m.intent)}</p>
  <div class="tags">${tagsHtml}</div>
  <details><summary>摘要</summary><pre class="snippet">${esc(r.snippet)}</pre></details>
  ${r.content ? `<details open><summary>完整内容</summary><pre class="content">${esc(r.content)}</pre></details>` : ""}
  <div class="meta-footer">
    <span>${esc(m.project_description)}</span>
    ${m.source_project ? `<span class="project">${esc(m.source_project)}</span>` : ""}
  </div>
</article>`
  }).join("\n")

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>最近 ${hours} 小时的知识文档 (${results.length})</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px;max-width:960px;margin:0 auto}
h1{margin-bottom:8px;font-size:1.5em;color:#58a6ff}
.summary{color:#8b949e;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;margin-bottom:16px}
.card-header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px}
.card-header h2{font-size:1.15em;color:#58a6ff;word-break:break-all}
.card-header h2 a{color:inherit;text-decoration:none}
.card-header h2 a:hover{text-decoration:underline}
.card-header time{color:#8b949e;font-size:.85em;white-space:nowrap}
.intent{color:#d2a8ff;font-size:.9em;margin-bottom:8px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.tag{background:#1f6feb33;color:#58a6ff;padding:2px 8px;border-radius:12px;font-size:.8em}
details{margin-top:8px}
summary{cursor:pointer;color:#8b949e;font-size:.9em;user-select:none}
summary:hover{color:#c9d1d9}
pre{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;margin-top:8px;white-space:pre-wrap;word-break:break-word;font-size:.85em;line-height:1.5;max-height:500px;overflow-y:auto}
.meta-footer{display:flex;justify-content:space-between;color:#8b949e;font-size:.8em;margin-top:10px;border-top:1px solid #30363d;padding-top:8px}
.project{color:#7ee787}
</style>
</head>
<body>
<h1>最近 ${hours} 小时的知识文档</h1>
<p class="summary">共 ${results.length} 条</p>
${items}
</body>
</html>`
}

const mcp = new McpServer({ name: "knowledge-base", version: "1.0.0" })
registerTools(mcp)

type StreamableSession = { server: McpServer, transport: StreamableHTTPServerTransport }
const streamableSessions = new Map<string, StreamableSession>()
type SSESession = { server: McpServer, transport: SSEServerTransport }
const sseSessions = new Map<string, SSESession>()

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", chunk => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

function json(res: ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(body)
}

async function handleStreamableHttp(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined

  if (sessionId && streamableSessions.has(sessionId)) {
    const session = streamableSessions.get(sessionId)!
    if (!(session.transport instanceof StreamableHTTPServerTransport)) {
      json(res, { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: Session uses different transport" }, id: null }, 400)
      return
    }
    await session.transport.handleRequest(req, res, body)
    return
  }

  if (!sessionId && req.method === "POST" && body && isInitializeRequest(body)) {
    const server = new McpServer({ name: "knowledge-base", version: "1.0.0" })
    registerTools(server)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        streamableSessions.set(sid, { server, transport })
      },
    })
    transport.onclose = () => {
      if (transport.sessionId) streamableSessions.delete(transport.sessionId)
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
    return
  }

  json(res, { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID" }, id: null }, 400)
}

async function handleSSE(req: IncomingMessage, res: ServerResponse) {
  const transport = new SSEServerTransport("/messages", res)
  sseSessions.set(transport.sessionId, { server: null!, transport })
  res.on("close", () => sseSessions.delete(transport.sessionId))
  const server = new McpServer({ name: "knowledge-base", version: "1.0.0" })
  registerTools(server)
  sseSessions.set(transport.sessionId, { server, transport })
  await server.connect(transport)
}

async function handleSSEMessage(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const url = new URL(req.url!, `http://${req.headers.host}`)
  const sid = url.searchParams.get("sessionId")
  if (!sid) {
    json(res, { error: "Missing sessionId" }, 400)
    return
  }
  const session = sseSessions.get(sid)
  if (!session || !(session.transport instanceof SSEServerTransport)) {
    json(res, { error: "Session not found" }, 404)
    return
  }
  await session.transport.handlePostMessage(req, res, body)
}

async function handleRestAPI(req: IncomingMessage, res: ServerResponse, url: URL) {
  if (url.pathname === "/api/docs" && req.method === "GET") {
    json(res, listDocs())
    return
  }
  if (url.pathname === "/api/docs/recent" && req.method === "GET") {
    const hours = parseInt(url.searchParams.get("hours") || "24", 10)
    const since = url.searchParams.get("since") ? parseInt(url.searchParams.get("since")!, 10) : undefined
    const limit = parseInt(url.searchParams.get("limit") || "50", 10)
    const include_content = url.searchParams.get("include_content") === "true"
    const format = url.searchParams.get("format") || "json"
    const results = listRecentDocs({ hours, since, limit, include_content })
    if (format === "html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end(renderRecentHtml(results, hours))
    } else {
      json(res, results)
    }
    return
  }
  if (url.pathname.startsWith("/api/doc/") && req.method === "GET") {
    const id = url.pathname.slice("/api/doc/".length)
    json(res, readDoc(id, false))
    return
  }
  if (url.pathname === "/api/docs" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    json(res, readDoc(body.id, false))
    return
  }
  if (url.pathname === "/api/docs/write" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    const { title, content, tags, keywords, intent, project_description } = body
    if (!title || !content) {
      json(res, { error: "title and content are required" }, 400)
      return
    }
    const doc = writeDoc(
      {
        title,
        tags: tags || [],
        keywords: keywords || [],
        intent: intent || "",
        project_description: project_description || "",
        source_project: "",
        source_worktree: "",
      },
      content,
    )
    json(res, doc)
    return
  }
  if (url.pathname === "/api/search/semantic" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    try {
      const results = await searchDocsSemantic(body.query, body.limit || 10)
      json(res, results.map(d => ({
        id: d.id,
        title: d.title,
        tags: d.tags,
        keywords: d.keywords,
        source_project: d.source_project,
        score: Math.round(d.score * 1000) / 1000,
        created_at: d.created_at,
      })))
    } catch (e: any) {
      json(res, { error: e.message }, 500)
    }
    return
  }
  if (url.pathname === "/api/search" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    if (body.query) {
      try {
        json(res, await searchDocsCombined(body.query, body.keywords, body.tags, body.limit))
      } catch {
        json(res, searchDocs(body.query, body.keywords, body.tags, body.limit))
      }
      return
    }
    json(res, searchDocs(body.query, body.keywords, body.tags, body.limit))
    return
  }
  if (url.pathname === "/api/outlines" && req.method === "GET") {
    json(res, listAllOutlines())
    return
  }
  if (url.pathname === "/api/outline" && req.method === "GET") {
    const project = url.searchParams.get("project")
    if (!project) { json(res, { error: "project required" }, 400); return }
    json(res, getOutline(project))
    return
  }
  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = loadConfig()
    let storage
    try { storage = getStorageStats() } catch { storage = null }
    json(res, {
      ...config,
      storage,
      embedding: {
        ...config.embedding,
        apiKey: config.embedding.apiKey ? config.embedding.apiKey.slice(0, 8) + "..." : "",
      },
    })
    return
  }
  if (url.pathname === "/api/config" && req.method === "PUT") {
    const body = JSON.parse(await readBody(req))
    const current = loadConfig()
    const update = body

    if (update.embedding?.apiKey?.endsWith("...")) {
      update.embedding.apiKey = current.embedding.apiKey
    }

    const merged: AppConfig = {
      embedding: { ...current.embedding, ...update.embedding },
      search: {
        ...current.search,
        ...update.search,
        weights: { ...current.search.weights, ...update.search?.weights },
      },
    }

    saveConfig(merged)
    json(res, { success: true })
    return
  }
  if (url.pathname === "/api/embedding/reindex" && req.method === "POST") {
    try {
      const docs = listDocs()
      if (docs.length === 0) {
        json(res, { success: true, message: "No documents to reindex" })
        return
      }
      const count = await rebuildAllVectors(docs)
      json(res, { success: true, message: `Reindexed ${count} documents` })
    } catch (e: any) {
      json(res, { success: false, error: e.message }, 500)
    }
    return
  }
  if (url.pathname === "/api/kb-ask" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    const query = body.query
    if (!query || typeof query !== "string") {
      json(res, { error: "Missing or invalid 'query' field" }, 400)
      return
    }
    const hits = searchDocs(query, undefined, undefined, 3)
    if (hits.length > 0 && hits[0].score >= 40) {
      const best = hits[0]
      const full = readDoc(best.id, false)
      const content = full ? full.content.slice(0, 4000) : ""
      json(res, {
        from_kb: true,
        id: best.id,
        title: best.title,
        score: best.score,
        content,
        hint: "✅ 从知识库命中",
      })
    } else {
      const miss = recordMiss(query)
      json(res, {
        from_kb: false,
        miss: true,
        query,
        suggested_workflow: {
          step_1_search: `Search the web for "${query}"`,
          step_2_read: "Read the top results and extract key content",
          step_3_store: `POST /api/kb-ingest with the extracted content`,
        },
        total_misses: miss.total_misses,
        recurring: miss.recurring,
        hint: "未命中知识库，建议联网搜索后通过 /api/kb-ingest 入库",
      })
    }
    return
  }
  if (url.pathname === "/api/kb-ingest" && req.method === "POST") {
    const body = JSON.parse(await readBody(req))
    const { url: docUrl, title, content, tags, keywords } = body
    if (!title || !content) {
      json(res, { error: "Missing required fields: title, content" }, 400)
      return
    }
    const autoKeywords = keywords?.length
      ? keywords
      : title.split(/[\s\-_\-—–,，、：:]+/).filter((w: string) => w.length >= 2)
    const finalTags = tags?.length ? tags : ["reference", "web-ingested"]
    const doc = writeDoc(
      {
        title,
        tags: finalTags,
        keywords: autoKeywords,
        intent: `Web-ingested content: ${title.slice(0, 60)}`,
        project_description: "web-ingest",
        project_path: "",
        source_project: "",
        source_worktree: "",
        related_projects: [],
        related_files: docUrl ? [docUrl] : [],
      },
      content,
    )
    resolveMiss(title)
    if (docUrl) resolveMiss(docUrl)
    json(res, { saved: true, id: doc.id, title: doc.title, miss_resolved: true })
    return
  }
  json(res, { error: "Not Found" }, 404)
}

function startHttp(port: number) {
  const serveWeb = process.argv.includes("--web")
  const webDist = join(import.meta.dir, "..", "web", "dist")
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`)

    try {
      if (url.pathname === "/mcp") {
        const body = req.method === "POST" ? JSON.parse(await readBody(req)) : undefined
        await handleStreamableHttp(req, res, body)
        return
      }
      if (url.pathname === "/sse" && req.method === "GET") {
        await handleSSE(req, res)
        return
      }
      if (url.pathname === "/messages" && req.method === "POST") {
        const body = JSON.parse(await readBody(req))
        await handleSSEMessage(req, res, body)
        return
      }
      if (url.pathname === "/health") {
        json(res, { status: "ok", service: "knowledge-base-mcp" })
        return
      }
      if (url.pathname === "/api/chat" && req.method === "POST") return handleChat(req, res)
      if (url.pathname === "/api/models" && req.method === "GET") return handleGetModels(req, res)
      if (url.pathname === "/api/models" && req.method === "PUT") return handleSetModel(req, res)
      if (url.pathname === "/api/sessions" && req.method === "GET") return handleListSessions(req, res)
      if (url.pathname === "/api/sessions" && req.method === "POST") return handleCreateSession(req, res)
      if (url.pathname.match(/^\/api\/sessions\/[^/]+\/rename$/) && req.method === "PUT") return handleRenameSession(req, res, url)
      if (url.pathname.match(/^\/api\/sessions\/[^/]+\/messages$/) && req.method === "GET") return handleGetMessages(req, res, url)
      if (url.pathname.startsWith("/api/sessions/") && req.method === "DELETE") return handleDeleteSession(req, res, url)
      if (url.pathname === "/api/favorites" && req.method === "GET") return handleListFavorites(req, res)
      if (url.pathname === "/api/favorites" && req.method === "POST") return handleAddFavorite(req, res)
      if (url.pathname.startsWith("/api/favorites/") && req.method === "DELETE") return handleDeleteFavorite(req, res, url)
      if (url.pathname === "/api/session-favorites" && req.method === "GET") return handleListSessionFavorites(req, res)
      if (url.pathname === "/api/session-favorites" && req.method === "POST") return handleAddSessionFavorite(req, res)
      if (url.pathname.startsWith("/api/session-favorites/") && req.method === "DELETE") return handleDeleteSessionFavorite(req, res, url)
      if (url.pathname.match(/^\/api\/share\/[^/]+$/) && req.method === "GET") return handleShareSession(req, res, url)
      if (url.pathname === "/api/skills/scan" && req.method === "POST") return handleScanSkills(req, res)
      if (url.pathname === "/api/skills/paths" && req.method === "GET") return handleGetSkillPaths(req, res)
      if (url.pathname === "/api/skills/paths" && req.method === "PUT") return handleUpdateSkillPaths(req, res)
      if (url.pathname === "/api/browser/detect" && req.method === "GET") return handleBrowserDetect(req, res)
      if (url.pathname === "/api/docs/keywords" && req.method === "GET") { json(res, getAllKeywords()); return }
      if (url.pathname === "/api/share" && req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" })
        res.end()
        return
      }
      if (url.pathname.startsWith("/api/")) {
        await handleRestAPI(req, res, url)
        return
      }
      if (serveWeb) {
        const fp = join(webDist, url.pathname === "/" ? "index.html" : url.pathname)
        if (existsSync(fp)) {
          res.writeHead(200, { "Content-Type": mimeTypes[extname(fp)] || "application/octet-stream" })
          res.end(readFileSync(fp))
          return
        }
        const idx = join(webDist, "index.html")
        if (existsSync(idx)) {
          res.writeHead(200, { "Content-Type": "text/html" })
          res.end(readFileSync(idx))
          return
        }
      }
      json(res, { error: "Not Found" }, 404)
    } catch (e: any) {
      console.error("Request error:", e)
      if (!res.headersSent) json(res, { error: e.message }, 500)
    }
  })

  server.listen(port, () => {
    console.log(`Knowledge Base MCP running on http://localhost:${port}`)
    console.log(`  StreamableHTTP: http://localhost:${port}/mcp`)
    console.log(`  SSE (legacy):   http://localhost:${port}/sse`)
    console.log(`  API:            http://localhost:${port}/api/docs`)
    if (serveWeb) {
      console.log(`  Web UI:         http://localhost:${port}`)
    }
  })
}

async function main() {
  initDb()

  const mode = process.argv.includes("--http") || process.argv.includes("--web") ? "http" : "stdio"

  if (mode === "stdio") {
    const transport = new StdioServerTransport()
    await mcp.connect(transport)
    console.error("Knowledge Base MCP running on stdio")
  } else {
    const portIdx = process.argv.indexOf("--port")
    const port = portIdx !== -1 ? parseInt(process.argv[portIdx + 1]) : 19877
    startHttp(port)
  }
}

main().catch(console.error)
