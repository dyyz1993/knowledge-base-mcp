import { readFileSync, existsSync } from "node:fs"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

export function registerFileTools(server: McpServer): void {
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
}
