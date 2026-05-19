import type { DeepReadItem } from "../types"
import { callLlm, type LlmConfig } from "../../search/llm-caller"

export async function synthesize(
  query: string,
  deepReadResults: DeepReadItem[],
  outline: string,
  largeModel: LlmConfig,
  qualityScore: number,
  coverageScore: number,
  researchType: string = "concept",
): Promise<{ text: string; isFallback: boolean }> {
  const successfulResults = deepReadResults.filter(r => r.success)
  const maxTotalChars = 20000
  const perItem = Math.min(4000, Math.floor(maxTotalChars / Math.max(successfulResults.length, 1)))
  
  const contentSections = successfulResults
    .map(
      (result, index) =>
        `## [${index + 1}] ${result.title} (${result.url})\n\n${result.content.slice(0, perItem)}`,
    )
    .join("\n\n---\n\n")

  const systemPrompt =
    "You are a research assistant. Provide comprehensive, well-structured answers with citations. Use [1], [2] etc. to reference sources. Answer in the same language as the query."

  const codeInstruction = ["api", "code", "concept"].includes(researchType)
    ? `2. **Must include code examples** — extract and reconstruct any code snippets from the content. Wrap ALL code in proper markdown code blocks with language tags (e.g. \`\`\`typescript, \`\`\`python). If the content describes APIs or functions, show usage examples with code blocks.`
    : `2. Include code examples only if the source content contains actual code — wrap in proper markdown code blocks with language tags.`

  const userPrompt = `Based on the following deep-read content about "${query}":
${contentSections}

Current outline:
${outline}

Quality assessment: ${qualityScore}/10, Coverage: ${coverageScore}/10

Synthesize a comprehensive answer that:
1. Directly answers the query with specific details
${codeInstruction}
3. Cites sources with [1], [2] etc. matching the source numbers
4. Is well-structured with headers (##) and bullet points
5. Notes any gaps or uncertainties if coverage is not perfect

Answer in the same language as the query.`

  try {
    const result = await callLlm(
      largeModel,
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      0.3,
      4000,
      120000,
    )

    if (result && result.trim().length >= 50) {
      return { text: result.trim(), isFallback: false }
    }
  } catch (e) {
    console.warn("[synthesize]", e instanceof Error ? e.message : String(e))
  }

  return { text: deepReadResults
    .map((result, index) => {
      const previewLines = result.content
        .split("\n")
        .filter((line) => line.trim().length > 20)
        .slice(0, 5)
        .join("\n")
      const preview = result.content.slice(0, 800)
      return `### [${index + 1}] ${result.title}\nSource: ${result.url}\n\n${previewLines || preview}`
    })
    .join("\n\n---\n\n"), isFallback: true }
}
