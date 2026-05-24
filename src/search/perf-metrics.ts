import { createLogger } from "../utils/logger.js"

const logger = createLogger("search:perf-metrics")

interface SearchMetrics {
  searchTimes: { total: number; token: number; tfidf: number; semantic: number; fuzzy: number }
  embeddingCacheHits: number
  embeddingCacheMisses: number
  tfCacheHits: number
  tfCacheMisses: number
  embeddingCalls: number
  embeddingTotalMs: number
  embeddingErrors: number
  totalSearches: number
  zeroResultSearches: number
  lastReset: number
}

function createEmpty(): SearchMetrics {
  return {
    searchTimes: { total: 0, token: 0, tfidf: 0, semantic: 0, fuzzy: 0 },
    embeddingCacheHits: 0,
    embeddingCacheMisses: 0,
    tfCacheHits: 0,
    tfCacheMisses: 0,
    embeddingCalls: 0,
    embeddingTotalMs: 0,
    embeddingErrors: 0,
    totalSearches: 0,
    zeroResultSearches: 0,
    lastReset: Date.now(),
  }
}

let metrics: SearchMetrics = createEmpty()

export function recordSearchTime(layer: "token" | "tfidf" | "semantic" | "fuzzy", ms: number): void {
  metrics.searchTimes[layer] += ms
  metrics.searchTimes.total += ms
}

export function recordSearch(results: number): void {
  metrics.totalSearches++
  if (results === 0) metrics.zeroResultSearches++
}

export function recordEmbeddingCall(ms: number, error?: boolean): void {
  metrics.embeddingCalls++
  metrics.embeddingTotalMs += ms
  if (error) metrics.embeddingErrors++
}

export function recordCacheHit(type: "embedding" | "tf"): void {
  if (type === "embedding") metrics.embeddingCacheHits++
  else metrics.tfCacheHits++
}

export function recordCacheMiss(type: "embedding" | "tf"): void {
  if (type === "embedding") metrics.embeddingCacheMisses++
  else metrics.tfCacheMisses++
}

export interface SearchMetricsSnapshot extends SearchMetrics {
  embeddingAvgMs: number
  embeddingCacheRate: number
  zeroResultRate: number
}

export function getSearchMetrics(): SearchMetricsSnapshot {
  return {
    ...metrics,
    embeddingAvgMs: metrics.embeddingCalls > 0
      ? Math.round(metrics.embeddingTotalMs / metrics.embeddingCalls) : 0,
    embeddingCacheRate: (metrics.embeddingCacheHits + metrics.embeddingCacheMisses) > 0
      ? metrics.embeddingCacheHits / (metrics.embeddingCacheHits + metrics.embeddingCacheMisses) : 0,
    zeroResultRate: metrics.totalSearches > 0
      ? metrics.zeroResultSearches / metrics.totalSearches : 0,
  }
}

export function resetSearchMetrics(): void {
  metrics = createEmpty()
  logger.info("Search performance metrics reset")
}
