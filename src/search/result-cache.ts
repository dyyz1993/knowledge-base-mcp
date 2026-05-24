import { createLogger } from "../utils/logger.js"

const logger = createLogger("search:result-cache")

interface CacheEntry<T> {
  results: T
  timestamp: number
}

const cache = new Map<string, CacheEntry<unknown>>()
const MAX_CACHE_SIZE = 200
const CACHE_TTL = 30_000

export function getCachedResults<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return entry.results as T
}

export function setCachedResults<T>(key: string, results: T): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    const keys = [...cache.keys()].slice(0, 50)
    for (const k of keys) cache.delete(k)
  }
  cache.set(key, { results, timestamp: Date.now() })
}

export function invalidateResultCache(): void {
  cache.clear()
}

export function getResultCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return { size: cache.size, maxSize: MAX_CACHE_SIZE, ttlMs: CACHE_TTL }
}
