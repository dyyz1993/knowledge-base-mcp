import type { OpenAITool } from "./types.js"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { rmSync } from "node:fs"
import { createLogger } from "../../utils/logger.js"

const logger = createLogger("chat:git-clone")
const execFileAsync = promisify(execFile)

export const gitCloneDef: OpenAITool = {
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
}

function validateBranchName(branch: string): boolean {
  return /^[a-zA-Z0-9\/_.-]+$/.test(branch)
}

export async function executeGitClone(args: Record<string, unknown>): Promise<string> {
  const { url, branch, depth = 1 } = args as { url: string; branch?: string; depth?: number }

  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("git://")) {
    return "URL 必须以 http://, https:// 或 git:// 开头"
  }

  if (branch && !validateBranchName(branch)) {
    return `Invalid branch name: ${branch}`
  }

  const repoName = url.split("/").pop()?.replace(".git", "") || "repo"
  const targetDir = join(tmpdir(), `kb-clone-${repoName}-${Date.now()}`)

  try {
    const cloneArgs = ["clone", `--depth=${depth}`]
    if (branch) cloneArgs.push("--branch", branch)
    cloneArgs.push(url, targetDir)

    await execFileAsync("git", cloneArgs, { encoding: "utf-8", timeout: 120000 })

    const { stdout: structure } = await execFileAsync(
      "find",
      [".", "-maxdepth", "3", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*", "-not", "-path", "*/dist/*"],
      { encoding: "utf-8", cwd: targetDir },
    )

    return JSON.stringify({
      path: targetDir,
      message: `已克隆到 ${targetDir}`,
      structure: structure.trim(),
    })
  } catch (e: unknown) {
    try { rmSync(targetDir, { recursive: true }) } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
    return `克隆失败: ${e instanceof Error ? e.message : String(e)}`
  }
}
