import type { OpenAITool } from "./types.js"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { writeDoc } from "../../storage/index.js"
import { buildTree } from "./helpers.js"
import { createLogger } from "../../utils/logger.js"

const logger = createLogger("chat:scan-project")
const execFileAsync = promisify(execFile)

export const scanProjectDef: OpenAITool = {
  type: "function",
  function: {
    name: "scan_project",
    description: "Scan a project directory to extract key information including tech stack, structure, dependencies, and README. Results can be saved to the knowledge base.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path of the project directory to scan" },
        save: { type: "boolean", description: "Whether to auto-save scan results to knowledge base (default: false)" },
      },
      required: ["path"],
    },
  },
}

export async function executeScanProject(args: Record<string, unknown>): Promise<string> {
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
    const { stdout: treeOutput } = await execFileAsync(
      "find",
      [".", "-maxdepth", "4", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*", "-not", "-path", "*/dist/*", "-not", "-path", "*/.next/*", "-not", "-path", "*/build/*", "-not", "-path", "*/coverage/*"],
      { encoding: "utf-8", timeout: 10000, cwd: projectPath },
    )
    const lines = treeOutput.trim().split("\n").sort().slice(0, 150)
    const tree = buildTree(lines)
    results.push(`${projectName}/\n${tree}`)
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
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
    } catch (e) {
      logger.warn(e instanceof Error ? e.message : String(e))
    }
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
