import type { OpenAITool } from "./types.js"
import { existsSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const runScriptDef: OpenAITool = {
  type: "function",
  function: {
    name: "run_script",
    description: "执行 Python 或 Bun 脚本（只读操作，如数据分析、文件处理、格式转换）。脚本在沙盒中执行，有 30 秒超时限制。",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "bun"], description: "脚本语言：python 或 bun" },
        code: { type: "string", description: "要执行的脚本代码" },
      },
      required: ["language", "code"],
    },
  },
}

export async function executeRunScript(args: Record<string, unknown>): Promise<string> {
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
        const { stdout, stderr } = await execFileAsync("python3", [tmpFile], { encoding: "utf-8", timeout: 35000, maxBuffer: 1024 * 1024 })
        const result = stdout + (stderr ? "\n" + stderr : "")
        return result.slice(0, 5000) || "(脚本执行成功，无输出)"
      } finally {
        unlinkSync(tmpFile)
      }
    } else {
      const tmpFile = join(tmpdir(), `kb-script-${Date.now()}.ts`)
      writeFileSync(tmpFile, code, "utf-8")
      try {
        const { stdout, stderr } = await execFileAsync("bun", ["run", tmpFile], { encoding: "utf-8", timeout: 35000, maxBuffer: 1024 * 1024 })
        const result = stdout + (stderr ? "\n" + stderr : "")
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
