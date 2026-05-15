import type { SearchSource, AggregatedResult } from "./types"
import { aggregateResults } from "./result-aggregator"

function log(level: string, msg: string) {
  const ts = new Date().toISOString().substring(11, 19)
  console.log(`[${ts}] [search] [${level}] ${msg}`)
}

export class SearchPipeline {
  private sources: SearchSource[]

  constructor(sources: SearchSource[]) {
    this.sources = sources
  }

  async search(query: string, maxResults = 10): Promise<AggregatedResult> {
    const start = Date.now()
    const availableSources = this.sources.filter(s => s.available())

    log("INFO", `Query: "${query}" | Sources: [${availableSources.map(s => s.name).join(", ")}] | maxResults: ${maxResults}`)

    const allResults: Awaited<ReturnType<SearchSource["search"]>> = []
    const sourceTimings: { name: string; ms: number; count: number; error?: string }[] = []

    const xbrowserSources = availableSources.filter(s => s.name.startsWith("xbrowser-"))
    const otherSources = availableSources.filter(s => !s.name.startsWith("xbrowser-"))

    const runSource = async (source: SearchSource) => {
      const t0 = Date.now()
      try {
        const results = await source.search(query)
        const ms = Date.now() - t0
        allResults.push(...results)
        sourceTimings.push({ name: source.name, ms, count: results.length })
        log("INFO", `Source [${source.name}]: ${results.length} results in ${ms}ms`)
        for (const r of results.slice(0, 3)) {
          log("DEBUG", `  -> [${source.name}] ${r.title?.substring(0, 60)} | ${r.url?.substring(0, 60)}`)
        }
      } catch (err) {
        const ms = Date.now() - t0
        const errMsg = err instanceof Error ? err.message : String(err)
        sourceTimings.push({ name: source.name, ms, count: 0, error: errMsg })
        log("WARN", `Source [${source.name}] FAILED in ${ms}ms: ${errMsg}`)
      }
    }

    const otherPromises = otherSources.map(s => runSource(s))
    await Promise.all(otherPromises)

    for (const xs of xbrowserSources) {
      await runSource(xs)
    }

    log("INFO", `Raw total: ${allResults.length} results before aggregation`)
    const aggregated = aggregateResults(allResults, query, maxResults)
    log("INFO", `After aggregation: ${aggregated.length} results (deduped + scored)`)

    for (const r of aggregated) {
      log("DEBUG", `  #${aggregated.indexOf(r) + 1} [${r.qualityScore}pts] [${r.source}] [${r.sourceType}] ${r.title?.substring(0, 50)} | ${r.url?.substring(0, 50)}`)
    }

    const durationMs = Date.now() - start
    log("INFO", `Done: ${durationMs}ms total | Sources: ${sourceTimings.map(s => `${s.name}=${s.count}/${s.ms}ms${s.error ? " ERR" : ""}`).join(", ")}`)

    return {
      query,
      results: aggregated,
      totalSources: availableSources.length,
      durationMs,
      sourceTimings,
      hint: aggregated.length > 0
        ? `搜索完成（${availableSources.length} 个来源，${aggregated.length} 条结果，耗时 ${(durationMs / 1000).toFixed(1)}s）`
        : "未找到相关结果",
    }
  }
}
