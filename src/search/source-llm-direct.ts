import type { SearchSource, SearchResult } from "./types"
import { getConfiguredModels } from "../chat/api-models"

export class LlmDirectSource implements SearchSource {
  name = "llm-direct" as const

  available(): boolean {
    const models = getConfiguredModels().filter(m => m.apiKey && m.baseUrl)
    return models.length > 0
  }

  async search(query: string): Promise<SearchResult[]> {
    const models = getConfiguredModels().filter(m => m.apiKey && m.baseUrl)
    if (models.length === 0) return []

    const smallPatterns = [/air/i, /flash/i, /mini/i, /turbo/i]
    let model = models.find(m => smallPatterns.some(p => p.test(m.id)))
    if (!model) model = models[0]

    try {
      const resp = await fetch(`${model.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify({
          model: model.id,
          messages: [
            { role: "system", content: "你是一个知识助手。请简洁准确地回答用户的问题。回答控制在500字以内。" },
            { role: "user", content: query },
          ],
          max_tokens: 1000,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30000),
      })
      const data = await resp.json() as Record<string, unknown>
      const choices = data.choices as Array<{ message: { content: string } }> | undefined
      const content = choices?.[0]?.message?.content
      if (!content) return []

      return [{
        title: `PI 回答: ${query.slice(0, 50)}`,
        url: "",
        snippet: content.slice(0, 500),
        content,
        source: "llm-direct",
        sourceType: "llm-knowledge",
        qualityScore: 7,
      }]
    } catch {
      return []
    }
  }
}
