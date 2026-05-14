import type { SearchSource, AggregatedResult } from "./types"
import { aggregateResults } from "./result-aggregator"

export class SearchPipeline {
  private sources: SearchSource[]

  constructor(sources: SearchSource[]) {
    this.sources = sources
  }

  async search(query: string, maxResults = 10): Promise<AggregatedResult> {
    const start = Date.now()
    const availableSources = this.sources.filter(s => s.available())

    const allResults: Awaited<ReturnType<SearchSource["search"]>> = []
    const promises = availableSources.map(async (source) => {
      try {
        const results = await source.search(query)
        allResults.push(...results)
      } catch {
        // source failed, continue with others
      }
    })
    await Promise.all(promises)

    const aggregated = aggregateResults(allResults, query, maxResults)

    const durationMs = Date.now() - start
    return {
      query,
      results: aggregated,
      totalSources: availableSources.length,
      durationMs,
      hint: aggregated.length > 0
        ? `搜索完成（${availableSources.length} 个来源，${aggregated.length} 条结果，耗时 ${(durationMs / 1000).toFixed(1)}s）`
        : "未找到相关结果",
    }
  }
}
