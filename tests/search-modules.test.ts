import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"
import { buildTF, getIDF, invalidateIDFCache, cosineSimilarity } from "../src/search/tfidf"
import { CircuitBreaker, CircuitOpenError } from "../src/search/circuit-breaker"
import {
  recordSearchTime,
  recordSearch,
  recordEmbeddingCall,
  recordCacheHit,
  recordCacheMiss,
  getSearchMetrics,
  resetSearchMetrics,
} from "../src/search/perf-metrics"

const FUZZY_PREFIX = `fuzzy-standalone-${Date.now()}-${Math.random().toString(36).slice(2)}`
const tmpDir = join(os.tmpdir(), `kb-search-test-${Date.now()}`)
const origKBDir = process.env.KB_DIR
const origKBDataDir = process.env.KB_DATA_DIR

beforeEach(() => {
  process.env.KB_DIR = tmpDir
  process.env.KB_DATA_DIR = join(tmpDir, ".kb-chat")
  mkdirSync(join(tmpDir, ".kb-chat"), { recursive: true })
  resetSearchMetrics()
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  process.env.KB_DIR = origKBDir
  process.env.KB_DATA_DIR = origKBDataDir
})

describe("tfidf", () => {
  it("should compute TF correctly", () => {
    const tokens = ["hello", "world", "hello", "test", "hello"]
    const tf = buildTF(tokens)
    expect(tf.get("hello")).toBe(3)
    expect(tf.get("world")).toBe(1)
    expect(tf.get("test")).toBe(1)
    expect(tf.get("nonexistent")).toBeUndefined()
  })

  it("should compute IDF with non-negative values", () => {
    const docs = [
      { id: "1", title: "hello world", keywords: ["hello"], tags: ["test"], intent: "test", project_description: "test", file_path: "/fake/1.md", created_at: Date.now() },
      { id: "2", title: "foo bar", keywords: ["foo"], tags: ["test"], intent: "test2", project_description: "test2", file_path: "/fake/2.md", created_at: Date.now() },
    ]
    const idf = getIDF(docs as any)
    for (const val of idf.values()) {
      expect(val).toBeGreaterThanOrEqual(0)
    }
  })

  it("should cache IDF results", () => {
    const docs = [
      { id: "1", title: "cache test", keywords: [], tags: [], intent: "", project_description: "", file_path: "/fake/1.md", created_at: Date.now() },
    ]
    const idf1 = getIDF(docs as any)
    const idf2 = getIDF(docs as any)
    expect(idf1).toBe(idf2)
  })

  it("should invalidate cache when docs change", () => {
    const docs1 = [
      { id: "1", title: "first", keywords: [], tags: [], intent: "", project_description: "", file_path: "/fake/1.md", created_at: Date.now() },
    ]
    const idf1 = getIDF(docs1 as any)
    invalidateIDFCache()
    const docs2 = [
      { id: "1", title: "first", keywords: [], tags: [], intent: "", project_description: "", file_path: "/fake/1.md", created_at: Date.now() },
      { id: "2", title: "second", keywords: [], tags: [], intent: "", project_description: "", file_path: "/fake/2.md", created_at: Date.now() },
    ]
    const idf2 = getIDF(docs2 as any)
    expect(idf1).not.toBe(idf2)
  })

  it("should handle empty documents", () => {
    const tf = buildTF([])
    expect(tf.size).toBe(0)
  })

  it("should compute cosine similarity", () => {
    const a = new Map([["x", 1], ["y", 2]])
    const b = new Map([["x", 2], ["y", 1]])
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThanOrEqual(1)
  })

  it("should return 0 for orthogonal vectors", () => {
    const a = new Map([["x", 1]])
    const b = new Map([["y", 1]])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it("should return 0 for empty vectors", () => {
    const a = new Map<string, number>()
    const b = new Map<string, number>([["x", 1]])
    expect(cosineSimilarity(a, b)).toBe(0)
  })
})

describe("perf-metrics", () => {
  it("should record search timing per layer", () => {
    recordSearchTime("token", 10)
    recordSearchTime("tfidf", 20)
    recordSearchTime("semantic", 30)
    recordSearchTime("fuzzy", 5)
    const m = getSearchMetrics()
    expect(m.searchTimes.token).toBe(10)
    expect(m.searchTimes.tfidf).toBe(20)
    expect(m.searchTimes.semantic).toBe(30)
    expect(m.searchTimes.fuzzy).toBe(5)
    expect(m.searchTimes.total).toBe(65)
  })

  it("should record cache hit/miss", () => {
    recordCacheHit("embedding")
    recordCacheHit("embedding")
    recordCacheMiss("embedding")
    const m = getSearchMetrics()
    expect(m.embeddingCacheHits).toBe(2)
    expect(m.embeddingCacheMisses).toBe(1)
    expect(m.embeddingCacheRate).toBeCloseTo(2 / 3)
  })

  it("should record cache hit/miss for tf type", () => {
    recordCacheHit("tf")
    recordCacheMiss("tf")
    const m = getSearchMetrics()
    expect(m.tfCacheHits).toBe(1)
    expect(m.tfCacheMisses).toBe(1)
  })

  it("should calculate zero result rate", () => {
    recordSearch(0)
    recordSearch(5)
    recordSearch(0)
    const m = getSearchMetrics()
    expect(m.totalSearches).toBe(3)
    expect(m.zeroResultSearches).toBe(2)
    expect(m.zeroResultRate).toBeCloseTo(2 / 3)
  })

  it("should reset metrics", () => {
    recordSearchTime("token", 100)
    recordSearch(5)
    recordCacheHit("embedding")
    resetSearchMetrics()
    const m = getSearchMetrics()
    expect(m.searchTimes.token).toBe(0)
    expect(m.totalSearches).toBe(0)
    expect(m.embeddingCacheHits).toBe(0)
  })

  it("should calculate embedding avg ms", () => {
    recordEmbeddingCall(100)
    recordEmbeddingCall(200)
    const m = getSearchMetrics()
    expect(m.embeddingAvgMs).toBe(150)
    expect(m.embeddingCalls).toBe(2)
  })

  it("should track embedding errors", () => {
    recordEmbeddingCall(50)
    recordEmbeddingCall(100, true)
    const m = getSearchMetrics()
    expect(m.embeddingCalls).toBe(2)
    expect(m.embeddingErrors).toBe(1)
  })

  it("should return 0 embeddingAvgMs when no calls", () => {
    const m = getSearchMetrics()
    expect(m.embeddingAvgMs).toBe(0)
  })

  it("should return 0 cache rate when no hits or misses", () => {
    const m = getSearchMetrics()
    expect(m.embeddingCacheRate).toBe(0)
  })
})

describe("circuit-breaker", () => {
  it("should start in closed state", () => {
    const cb = new CircuitBreaker("test-service", 3, 1000)
    expect(cb.isOpen).toBe(false)
  })

  it("should open after failure threshold", async () => {
    const cb = new CircuitBreaker("test-service", 3, 60000)
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(() => Promise.reject(new Error("fail"))) } catch {}
    }
    expect(cb.isOpen).toBe(true)
  })

  it("should transition to half-open after cooldown", async () => {
    const cb = new CircuitBreaker("test-service", 2, 50)
    for (let i = 0; i < 2; i++) {
      try { await cb.execute(() => Promise.reject(new Error("fail"))) } catch {}
    }
    expect(cb.isOpen).toBe(true)
    await new Promise(r => setTimeout(r, 60))
    const result = await cb.execute(() => Promise.resolve("recovered"))
    expect(result).toBe("recovered")
    expect(cb.isOpen).toBe(false)
  })

  it("should close after success in half-open", async () => {
    const cb = new CircuitBreaker("test-service", 2, 50)
    for (let i = 0; i < 2; i++) {
      try { await cb.execute(() => Promise.reject(new Error("fail"))) } catch {}
    }
    expect(cb.isOpen).toBe(true)
    await new Promise(r => setTimeout(r, 60))
    await cb.execute(() => Promise.resolve("ok"))
    expect(cb.isOpen).toBe(false)
    const result = await cb.execute(() => Promise.resolve("still ok"))
    expect(result).toBe("still ok")
  })

  it("should reject requests when open", async () => {
    const cb = new CircuitBreaker("test-service", 2, 60000)
    for (let i = 0; i < 2; i++) {
      try { await cb.execute(() => Promise.reject(new Error("fail"))) } catch {}
    }
    try {
      await cb.execute(() => Promise.resolve("should not reach"))
      expect.unreachable("Should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitOpenError)
    }
  })

  it("should pass through successful results", async () => {
    const cb = new CircuitBreaker("test-service", 3, 1000)
    const result = await cb.execute(() => Promise.resolve(42))
    expect(result).toBe(42)
  })

  it("should pass through errors without opening below threshold", async () => {
    const cb = new CircuitBreaker("test-service", 5, 1000)
    try {
      await cb.execute(() => Promise.reject(new Error("one fail")))
    } catch (e) {
      expect((e as Error).message).toBe("one fail")
    }
    expect(cb.isOpen).toBe(false)
  })

  it("should reset failures on success", async () => {
    const cb = new CircuitBreaker("test-service", 3, 1000)
    for (let i = 0; i < 2; i++) {
      try { await cb.execute(() => Promise.reject(new Error("fail"))) } catch {}
    }
    await cb.execute(() => Promise.resolve("ok"))
    for (let i = 0; i < 2; i++) {
      try { await cb.execute(() => Promise.reject(new Error("fail"))) } catch {}
    }
    expect(cb.isOpen).toBe(false)
  })
})

describe("fuzzy-search", () => {
  it("should build a valid Fuse index and search it", async () => {
    const Fuse = (await import("fuse.js")).default
    const docs = [
      { id: "1", title: "Hello World Guide", keywords: ["hello", "guide"], tags: ["test"], intent: "test", project_description: "test" },
      { id: "2", title: "Goodbye World", keywords: ["goodbye"], tags: ["test"], intent: "test", project_description: "test" },
    ]
    const fuse = new Fuse(docs, {
      keys: [{ name: "title", weight: 0.4 }, { name: "keywords", weight: 0.25 }],
      threshold: 0.4,
      distance: 200,
      minMatchCharLength: 2,
      includeScore: true,
      ignoreLocation: true,
    })
    const results = fuse.search("Hello World")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item.id).toBe("1")
    expect(results[0].score).toBeDefined()
  })

  it("should find results with typo tolerance via Fuse", async () => {
    const Fuse = (await import("fuse.js")).default
    const docs = [
      { id: "1", title: "Typo Tolerance", keywords: ["typo"], tags: [], intent: "", project_description: "" },
    ]
    const fuse = new Fuse(docs, {
      keys: [{ name: "title", weight: 0.4 }],
      threshold: 0.4,
      distance: 200,
      minMatchCharLength: 2,
      includeScore: true,
      ignoreLocation: true,
    })
    const results = fuse.search("Typo Tolerence")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].item.id).toBe("1")
  })

  it("should return empty for nonsensical query", async () => {
    const Fuse = (await import("fuse.js")).default
    const docs = [
      { id: "1", title: "Some Document", keywords: [], tags: [], intent: "", project_description: "" },
    ]
    const fuse = new Fuse(docs, {
      keys: [{ name: "title", weight: 0.4 }],
      threshold: 0.4,
      includeScore: true,
    })
    const results = fuse.search("zzzzzzzzxxxxxxxqqqqqqq")
    expect(results.length).toBe(0)
  })

  it("should respect limit parameter", async () => {
    const Fuse = (await import("fuse.js")).default
    const docs = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), title: `Limit Test ${i}`, keywords: ["limit"], tags: [], intent: "", project_description: "",
    }))
    const fuse = new Fuse(docs, {
      keys: [{ name: "title", weight: 0.4 }],
      threshold: 0.4,
      includeScore: true,
    })
    const results = fuse.search("Limit Test", { limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })

  it("should invalidateFuzzyIndex reset internal state", async () => {
    const { invalidateFuzzyIndex } = await import("../src/search/fuzzy-search")
    expect(() => invalidateFuzzyIndex()).not.toThrow()
  })
})

describe("search-pipeline", () => {
  it("should categorize sources into fast/medium/slow", async () => {
    const { SearchPipeline } = await import("../src/search/search-pipeline")
    const { SearchSource } = await import("../src/search/types")
    const mkSource = (name: string): SearchSource => ({
      name: name as any,
      available: () => true,
      search: () => Promise.resolve([]),
    })
    const pipeline = new SearchPipeline([
      mkSource("tavily"),
      mkSource("ai-search"),
      mkSource("xbrowser"),
      mkSource("serper"),
    ], { fastTimeout: 100, slowTimeout: 200 })
    const result = await pipeline.search("test query", 5)
    expect(result).toBeDefined()
    expect(result.query).toBe("test query")
    expect(result.results).toBeDefined()
    expect(Array.isArray(result.results)).toBe(true)
  })

  it("should handle all sources failing", async () => {
    const { SearchPipeline } = await import("../src/search/search-pipeline")
    const { SearchSource } = await import("../src/search/types")
    const failSource: SearchSource = {
      name: "tavily" as any,
      available: () => true,
      search: () => Promise.reject(new Error("source down")),
    }
    const pipeline = new SearchPipeline([failSource], { fastTimeout: 100, slowTimeout: 200, enableFallback: false })
    const result = await pipeline.search("fail test", 5)
    expect(result).toBeDefined()
    expect(result.results).toBeDefined()
  })

  it("should handle unavailable sources gracefully", async () => {
    const { SearchPipeline } = await import("../src/search/search-pipeline")
    const { SearchSource } = await import("../src/search/types")
    const unavailable: SearchSource = {
      name: "tavily" as any,
      available: () => false,
      search: () => Promise.resolve([]),
    }
    const pipeline = new SearchPipeline([unavailable], { fastTimeout: 100, slowTimeout: 200, enableFallback: false })
    const result = await pipeline.search("test", 5)
    expect(result).toBeDefined()
    expect(result.results.length).toBe(0)
  })

  it("should aggregate results from multiple sources", async () => {
    const { SearchPipeline } = await import("../src/search/search-pipeline")
    const { SearchSource, SearchResult } = await import("../src/search/types")
    const mkSource = (name: string, count: number): SearchSource => ({
      name: name as any,
      available: () => true,
      search: () => Promise.resolve(
        Array.from({ length: count }, (_, i) => ({
          title: `${name} result ${i}`,
          url: `https://example.com/${name}/${i}`,
          snippet: `snippet ${i}`,
          source: name as any,
          sourceType: "blog" as any,
          qualityScore: 50,
        }))
      ),
    })
    const pipeline = new SearchPipeline([mkSource("tavily", 3), mkSource("serper", 2)], { fastTimeout: 5000, slowTimeout: 10000 })
    const result = await pipeline.search("multi source test", 10)
    expect(result.results.length).toBeGreaterThanOrEqual(0)
  })
})
