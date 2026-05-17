import type { SearchSource, AggregatedResult, SourceTiming, SearchResult } from "./types"
import { aggregateResults } from "./result-aggregator"
import { searchStats } from "../statistics"

function log(level: string, msg: string) {
  const ts = new Date().toISOString().substring(11, 19)
  console.log(`[${ts}] [search] [${level}] ${msg}`)
}

export class SearchPipeline {
  private fastSources: SearchSource[]
  private slowSources: SearchSource[]
  private fastTimeout: number
  private slowTimeout: number

  constructor(sources: SearchSource[], options?: { fastTimeout?: number; slowTimeout?: number }) {
    this.slowSources = sources.filter(s => s.name === "ai-search")
    this.fastSources = sources.filter(s => s.name !== "ai-search")
    this.fastTimeout = options?.fastTimeout ?? 10_000
    this.slowTimeout = options?.slowTimeout ?? 60_000
  }

  async search(query: string, maxResults = 10): Promise<AggregatedResult> {
    const start = Date.now()
    const allResults: SearchResult[] = []
    const sourceTimings: SourceTiming[] = []

    log("INFO", `Query: "${query}" | Fast: [${this.fastSources.filter(s => s.available()).map(s => s.name).join(", ")}] | Slow: [${this.slowSources.filter(s => s.available()).map(s => s.name).join(", ")}] | maxResults: ${maxResults}`)

    searchStats.recordQuery()

    // Phase 1: fast sources in parallel
    const fastPromise = this.runSources(this.fastSources, query, allResults, sourceTimings)

    // Phase 2: wait for fast sources with timeout
    const fastResults = await Promise.race([
      fastPromise.then(() => allResults.length),
      new Promise<number>(resolve => setTimeout(() => resolve(-1), this.fastTimeout)),
    ])

    const fastOnly = fastResults >= 0
    const fastCount = fastOnly ? fastResults : allResults.length

    if (!fastOnly) {
      log("INFO", `Fast timeout (${this.fastTimeout}ms) reached with ${fastCount} results, continuing to wait for fast sources...`)
      await fastPromise
    }

    log("INFO", `Fast phase done: ${allResults.length} results`)

    const needSlow = allResults.length < 3 && this.slowSources.length > 0

    if (needSlow) {
      log("INFO", `Only ${allResults.length} fast results (< 3), activating slow sources...`)

      const slowResults: SearchResult[] = []
      const slowTimings: SourceTiming[] = []

      await Promise.race([
        this.runSources(this.slowSources, query, slowResults, slowTimings),
        new Promise<void>(resolve => setTimeout(() => resolve(), this.slowTimeout)),
      ])

      sourceTimings.push(...slowTimings)
      allResults.push(...slowResults)
      log("INFO", `Slow phase done: +${slowResults.length} results (total: ${allResults.length})`)
    } else if (this.slowSources.length > 0) {
      log("INFO", `Fast results sufficient (${allResults.length} >= 3), skipping slow sources`)
    }

    log("INFO", `Raw total: ${allResults.length} results before aggregation`)
    const aggregated = aggregateResults(allResults, query, maxResults)
    log("INFO", `After aggregation: ${aggregated.length} results (deduped + scored)`)

    for (let i = 0; i < aggregated.length; i++) {
      const r = aggregated[i]
      log("DEBUG", `  #${i + 1} [${r.qualityScore}pts] [${r.source}] [${r.sourceType}] ${r.title?.substring(0, 50)} | ${r.url?.substring(0, 50)}`)
    }

    const durationMs = Date.now() - start
    log("INFO", `Done: ${durationMs}ms total | Sources: ${sourceTimings.map(s => `${s.name}=${s.count}/${s.ms}ms${s.error ? " ERR" : ""}`).join(", ")}`)

    return {
      query,
      results: aggregated,
      totalSources: sourceTimings.length,
      durationMs,
      sourceTimings,
      hint: aggregated.length > 0
        ? `搜索完成（${sourceTimings.length} 个来源，${aggregated.length} 条结果，耗时 ${(durationMs / 1000).toFixed(1)}s）`
        : "未找到相关结果",
    }
  }

  private async runSources(
    sources: SearchSource[],
    query: string,
    outResults: SearchResult[],
    outTimings: SourceTiming[],
  ): Promise<void> {
    const available = sources.filter(s => s.available())
    if (available.length === 0) return

    await Promise.allSettled(available.map(async source => {
      const t0 = Date.now()
      try {
        const results = await source.search(query)
        const ms = Date.now() - t0
        outResults.push(...results)
        outTimings.push({ name: source.name, ms, count: results.length })
        log("INFO", `Source [${source.name}]: ${results.length} results in ${ms}ms`)
        searchStats.recordSourceCall(source.name, results.length, ms, false)
        for (const r of results.slice(0, 3)) {
          log("DEBUG", `  -> [${source.name}] ${r.title?.substring(0, 60)} | ${r.url?.substring(0, 60)}`)
        }
      } catch (err) {
        const ms = Date.now() - t0
        const errMsg = err instanceof Error ? err.message : String(err)
        outTimings.push({ name: source.name, ms, count: 0, error: errMsg })
        log("WARN", `Source [${source.name}] FAILED in ${ms}ms: ${errMsg}`)
        searchStats.recordSourceCall(source.name, 0, ms, true)
      }
    }))
  }
}
