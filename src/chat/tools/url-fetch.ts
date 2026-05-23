import type { OpenAITool } from "./types.js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { stripHtmlTags } from "./helpers.js"

const execFileAsync = promisify(execFile)

export const urlFetchDef: OpenAITool = {
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
}

export async function executeUrlFetch(args: Record<string, unknown>): Promise<string> {
  const { url, max_length = 10000 } = args as { url: string; max_length?: number }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "URL 必须以 http:// 或 https:// 开头"
  }

  try {
    const { stdout: result } = await execFileAsync("curl", ["-sL", "--max-time", "15", url], { encoding: "utf-8", timeout: 20000, maxBuffer: 2 * 1024 * 1024 })

    let text = result
    if (text.includes("<html") || text.includes("<!DOCTYPE")) {
      text = stripHtmlTags(text)
    }

    return text.slice(0, max_length) || "(无内容)"
  } catch (e: unknown) {
    return `访问失败: ${e instanceof Error ? e.message : String(e)}`
  }
}
