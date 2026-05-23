import type { OpenAITool } from "./types.js"
import { existsSync, readFileSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const readFileDef: OpenAITool = {
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
}

export async function executeReadFile(args: Record<string, unknown>): Promise<string> {
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

export const grepSearchDef: OpenAITool = {
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
}

export async function executeGrepSearch(args: Record<string, unknown>): Promise<string> {
  const pattern = String(args.pattern ?? "")
  if (!pattern) return "Search pattern is required."
  const dir = String(args.path ?? ".")
  if (dir.includes("..")) return "安全限制：路径不允许包含 .."
  const include = args.include ? String(args.include) : "*"
  const maxResults = Number(args.max_results) || 20
  try {
    const { stdout: result } = await execFileAsync(
      "grep",
      ["-rn", `--include=${include}`, "-E", pattern, dir],
      { encoding: "utf-8", timeout: 10000, maxBuffer: 512 * 1024 },
    )
    if (!result.trim()) return `No matches found for pattern "${pattern}" in ${dir}`
    return result.trim().split("\n").slice(0, maxResults).join("\n")
  } catch (e: unknown) {
    const err = e as { code?: unknown; message?: string }
    if (err.code === 1 || err.code === "1") return `No matches found for pattern "${pattern}" in ${dir}`
    return `搜索失败: ${err.message || String(e)}`
  }
}
