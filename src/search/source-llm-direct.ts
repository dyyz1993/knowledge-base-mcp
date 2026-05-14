import type { SearchSource, SearchResult } from "./types"

interface LlmDirectConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

export class LlmDirectSource implements SearchSource {
  name = "llm-direct" as const
  private config: LlmDirectConfig

  constructor(config: LlmDirectConfig) {
    this.config = config
  }

  available(): boolean {
    return this.config.enabled && !!this.config.apiKey && !!this.config.baseUrl
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.available()) return []
    try {
      const resp = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: "你是一个知识助手。请简洁准确地回答用户的问题。如果你知道答案，请直接给出；如果不确定，请说明。回答控制在500字以内。" },
            { role: "user", content: query },
          ],
          max_tokens: 1000,
          temperature: 0.3,
        }),
      })
      const data = await resp.json() as Record<string, unknown>
      const choices = data.choices as Array<{ message: { content: string } }> | undefined
      const content = choices?.[0]?.message?.content
      if (!content) return []

      return [{
        title: `LLM 回答: ${query.slice(0, 50)}`,
        url: "",
        snippet: content.slice(0, 500),
        content,
        source: "llm-direct",
        sourceType: "llm-knowledge",
        qualityScore: 0,
      }]
    } catch {
      return []
    }
  }
}
