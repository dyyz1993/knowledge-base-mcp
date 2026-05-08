import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, basename } from "node:path"
import { homedir } from "node:os"

const KB_DIR = join(homedir(), ".knowledge")
const CONCURRENCY = 5
const RETRY_MAX = 3
const BASE_DELAY = 2000

interface ModelConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
}

function loadModelConfig(): ModelConfig {
  const configPath = join(homedir(), ".pi/agent/models.json")
  const config = JSON.parse(readFileSync(configPath, "utf-8"))
  const zhipuai = config.providers.zhipuai
  return {
    id: "glm-4.5-air",
    name: "GLM-4.5 Air",
    baseUrl: zhipuai.baseUrl,
    apiKey: zhipuai.apiKey,
  }
}

interface DocMeta {
  fm: string
  body: string
  id: string
  title: string
  project_path: string
  source_project: string
  keywords: string[]
  tags: string[]
  intent: string
  related_files: string[]
  related_projects: string[]
}

function parseFrontmatter(content: string): DocMeta | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fm = match[1]
  const body = content.slice(match[0].length)

  const get = (key: string) => {
    const m = fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : ""
  }

  const getArray = (key: string): string[] => {
    const m = fm.match(new RegExp(`^${key}:\\s*\\[.*?\\]$`, "m"))
    if (!m) return []
    const inner = m[0].match(/\[(.*?)\]/)
    if (!inner) return []
    return inner[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
  }

  return {
    fm, body,
    id: get("id"),
    title: get("title"),
    project_path: get("project_path"),
    source_project: get("source_project"),
    keywords: getArray("keywords"),
    tags: getArray("tags"),
    intent: get("intent"),
    related_files: getArray("related_files"),
    related_projects: getArray("related_projects"),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function inferRelations(
  doc: DocMeta,
  model: ModelConfig,
  retries = RETRY_MAX,
): Promise<{ related_files: string[]; related_projects: string[] }> {
  const contentPreview = doc.body.split("\n").slice(0, 60).join("\n")

  const prompt = `根据以下文档信息，推断关联的源码文件和相关项目。只输出JSON，格式：{"related_files":["path/to/file.ts"],"related_projects":["project-name"]}

文档: ${doc.title}
项目路径: ${doc.project_path || doc.source_project || "未知"}
关键词: ${doc.keywords.join(", ")}
用途: ${doc.intent}
标签: ${doc.tags.join(", ")}

内容摘要:
${contentPreview}

规则:
- related_files: 文档中提到的或与内容相关的源码文件路径(相对项目根目录)，最多5个。根据文档标题和内容推断可能的文件路径。
- related_projects: 文档中提到的其他项目名或npm包名，最多3个
- 如果文档讨论的是某个框架/工具，把该框架/工具的包名作为 related_projects
- 如果文档提到了具体文件路径，提取出来作为 related_files
- 必须输出JSON`

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(`${model.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model.id,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 300,
        }),
      })

      if (resp.status === 429) {
        const delay = BASE_DELAY * Math.pow(2, attempt)
        console.log(`  ⏳ 429 rate limit, 等待 ${delay}ms 后重试 (${attempt + 1}/${retries})...`)
        await sleep(delay)
        continue
      }

      if (!resp.ok) {
        const errText = await resp.text()
        throw new Error(`API error ${resp.status}: ${errText.slice(0, 200)}`)
      }

      const data = await resp.json()
      const text: string = data.choices?.[0]?.message?.content || ""

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return { related_files: [], related_projects: [] }

      const parsed = JSON.parse(jsonMatch[0])
      return {
        related_files: Array.isArray(parsed.related_files) ? parsed.related_files.slice(0, 5) : [],
        related_projects: Array.isArray(parsed.related_projects) ? parsed.related_projects.slice(0, 3) : [],
      }
    } catch (e: any) {
      if (attempt < retries && e.message?.includes("429")) continue
      if (attempt < retries) {
        await sleep(BASE_DELAY)
        continue
      }
      throw e
    }
  }
  return { related_files: [], related_projects: [] }
}

function updateFrontmatter(
  filePath: string,
  meta: DocMeta,
  updates: { related_files: string[]; related_projects: string[] },
) {
  let fm = meta.fm

  const filesStr = updates.related_files.map((f) => `"${f}"`).join(", ")
  const projectsStr = updates.related_projects.map((p) => `"${p}"`).join(", ")

  fm = fm.replace(/related_files:\s*\[.*?\]/, `related_files: [${filesStr}]`)
  fm = fm.replace(/related_projects:\s*\[.*?\]/, `related_projects: [${projectsStr}]`)

  const newContent = "---\n" + fm + "\n---" + meta.body
  writeFileSync(filePath, newContent, "utf-8")
}

async function main() {
  const model = loadModelConfig()
  console.log(`使用模型: ${model.id} (${model.name})`)
  console.log(`Base URL: ${model.baseUrl}`)
  console.log(`并发: ${CONCURRENCY}, 最大重试: ${RETRY_MAX}`)

  const files = readdirSync(KB_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(KB_DIR, f))

  console.log(`总文档数: ${files.length}`)

  const todos: { path: string; meta: DocMeta }[] = []

  for (const fp of files) {
    const content = readFileSync(fp, "utf-8")
    const meta = parseFrontmatter(content)
    if (!meta) continue
    if (meta.related_files.length === 0 || meta.related_projects.length === 0) {
      todos.push({ path: fp, meta })
    }
  }

  console.log(`需要补全: ${todos.length} 篇`)

  if (todos.length === 0) {
    console.log("所有文档已补全，无需处理")
    return
  }

  let done = 0
  let written = 0
  let empty = 0
  let failed = 0

  for (let i = 0; i < todos.length; i += CONCURRENCY) {
    const batch = todos.slice(i, i + CONCURRENCY)

    const results = await Promise.allSettled(
      batch.map(async ({ path, meta }) => {
        const result = await inferRelations(meta, model)
        const hasData = result.related_files.length > 0 || result.related_projects.length > 0
        if (hasData) {
          updateFrontmatter(path, meta, result)
        }
        return { path: basename(path), result, hasData }
      }),
    )

    for (const r of results) {
      done++
      if (r.status === "fulfilled") {
        const { path, result, hasData } = r.value
        if (hasData) {
          written++
          console.log(
            `[${done}/${todos.length}] ✅ ${path}: files=[${result.related_files.join(", ")}] projects=[${result.related_projects.join(", ")}]`,
          )
        } else {
          empty++
          console.log(`[${done}/${todos.length}] ⚠️  ${path}: 空结果`)
        }
      } else {
        failed++
        console.log(`[${done}/${todos.length}] ❌ 失败: ${r.reason}`)
      }
    }

    if (i + CONCURRENCY < todos.length) {
      await sleep(1000)
    }
  }

  console.log(`\n=== 完成 ===`)
  console.log(`成功写入: ${written}`)
  console.log(`空结果: ${empty}`)
  console.log(`失败: ${failed}`)
  console.log(`总计: ${todos.length}`)
}

main().catch(console.error)
