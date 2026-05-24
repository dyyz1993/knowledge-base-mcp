import { join } from "node:path"
import type { OpenAITool, ToolProgressCallback } from "./types.js"
import { loadConfig, getDataDir } from "../../config.js"
import { createLogger } from "../../utils/logger.js"

const logger = createLogger("chat:research")

export const kbResearchDef: OpenAITool = {
  type: "function",
  function: {
    name: "kb_research",
    description: "对指定主题进行深度研究。多源搜索 → URL 深读 → sitemap/github 发现 → 质量评估 → 结构化总结。返回研究报告（含参考资料和质量评分）。结果自动存入知识库，下次同类问题可直接命中，一次研究可反复复用。推荐用于知识库未覆盖的主题。",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "研究主题或问题" },
        mode: { type: "string", description: '研究模式 - "quick"(快速搜索)、"standard"(标准研究)、"deep"(深度研究)', default: "standard" },
      },
      required: ["query"],
    },
  },
}

export async function executeKbResearch(
  args: Record<string, unknown>,
  onProgress?: ToolProgressCallback,
): Promise<string> {
  const query = String(args.query || "")
  if (!query) return "query is required."

  const config = loadConfig()
  if (!config.searchPipeline?.enabled) {
    return `Error: Search pipeline not enabled. Enable searchPipeline in ${join(getDataDir(), "config.json")} to use kb_research.`
  }

  try {
    const { ResearchAgent } = await import("../../research/research-agent.js")
    const mode = (args.mode as "quick" | "standard" | "deep") || "standard"
    const agent = new ResearchAgent(
      { query, mode },
      (p) => { if (onProgress) onProgress(p) },
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

    let saveNote = ""
    if (result.summary && result.summary.length >= 200) {
      try {
        const { writeDoc } = await import("../../storage/index.js")
        const searchTitles = (result.searchResults || [])
          .flatMap(r => r.title.split(/[\s|\-–—:：,，.·/\\()（）\[\]]+/))
          .filter(w => w.length > 2 && w.length < 30)
          .map(w => w.toLowerCase())
        const queryWords = query.split(/[\s,，]+/).filter(w => w.length > 1)
        const allKw = [...new Set([...queryWords, ...searchTitles.slice(0, 8)])].slice(0, 10)

        const sources = (result.sources || []).map(s => `- [${s.title}](${s.url})`).slice(0, 10).join("\n")
        const fullSummary = result.summary + (sources ? `\n\n## 参考资料\n${sources}` : "")

        writeDoc(
          {
            title: `研究: ${query}`,
            tags: ["research", "auto-saved", result.mode, "web-ingested"],
            keywords: allKw,
            intent: `Auto-research for "${query}" (${result.mode}, Q:${result.finalQualityScore}/C:${result.finalCoverageScore})`,
            project_description: "Research results",
          },
          fullSummary,
        )
        saveNote = "\n\n✅ 已自动存入知识库"
      } catch (e) {
        logger.error("Auto-save failed", e instanceof Error ? e.message : e)
        saveNote = "\n\n⚠️ 自动存入知识库失败"
      }
    }

    return `# 研究报告: ${result.query}\n\n${result.summary}\n\n---\n📊 ${meta}${saveNote}`
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return `研究失败: ${msg}`
  }
}
