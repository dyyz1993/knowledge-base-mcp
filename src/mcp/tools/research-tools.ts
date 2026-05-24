import { readFileSync, readdirSync, statSync } from "node:fs"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { writeDoc, searchDocsSemantic, listDocs, getMissStats, resolveMiss } from "../../storage/index.js"
import { loadConfig, getKbDir } from "../../config.js"
import { createLogger } from "../../utils/logger.js"
import { buildSpawnEnv, curlEnv, gitEnv } from "../../utils/spawn-env.js"

const logger = createLogger("mcp:research-tools")

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

export function registerResearchTools(server: McpServer): void {
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
        let repoDir = tmpDir
        try {
          const zipUrl = `https://github.com/${args.repo}/archive/refs/heads/main.zip`
          const zipPath = `${tmpDir}.zip`
          const curlProc = Bun.spawn([
            "curl", "-fsSL", "--connect-timeout", "15", "--max-time", "30",
            "-o", zipPath, zipUrl,
          ], {
            stdout: "pipe", stderr: "pipe",
             env: curlEnv(),
           })
           const curlExit = await Promise.race([
             curlProc.exited,
             new Promise<number>((_, reject) => setTimeout(() => { curlProc.kill(); reject(new Error("curl timeout")) }, 35000)),
           ])
           if (curlExit === 0) {
             await Bun.spawn(["unzip", "-q", zipPath, "-d", tmpDir], {
               stdout: "pipe", stderr: "pipe",
               env: buildSpawnEnv(),
             }).exited
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

        if (!cloneOk) {
          try {
            const proc = Bun.spawn(["git", "clone", "--depth=1", `https://github.com/${args.repo}.git`, tmpDir], {
              stdout: "pipe",
              stderr: "pipe",
              env: gitEnv(),
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
      const idx = readFileSync(`${getKbDir()}/index.json`, "utf-8")
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

      const { ResearchAgent } = await import("../../research/research-agent.js")
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
