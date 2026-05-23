import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { CircuitBreaker, CircuitOpenError } from "../src/search/circuit-breaker"
import { searchDocs, searchDocsCombined, writeDoc } from "../src/storage/index"
import { cosineSimilarityVec, semanticSearch } from "../src/search/embedding"
import { SearchPipeline } from "../src/search/search-pipeline"
import type { SearchSource, AggregatedResult } from "../src/search/types"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const TEST_DIR = join(tmpdir(), `kb-degradation-test-${Date.now()}`)

let hasTransformers = false
try { require.resolve("@huggingface/transformers"); hasTransformers = true } catch { hasTransformers = false }

beforeEach(() => {
  process.env.KB_DIR = TEST_DIR
  if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
  delete process.env.KB_DIR
  try { rmSync(TEST_DIR, { recursive: true, force: true }) } catch {}
})

function seedDoc(id: string, title: string, keywords: string[] = [], body = "test content body") {
  writeDoc(
    {
      id,
      title,
      keywords,
      tags: ["document"],
      intent: "test",
      project_description: "test",
    },
    body,
  )
}

describe("CircuitBreaker", () => {
  it("should allow requests when closed", async () => {
    const cb = new CircuitBreaker("test", 3, 1000)
    const result = await cb.execute(() => Promise.resolve("ok"))
    expect(result).toBe("ok")
  })

  it("should open after threshold failures", async () => {
    const cb = new CircuitBreaker("test", 2, 60000)
    const fail = () => Promise.reject(new Error("fail"))

    await expect(cb.execute(fail)).rejects.toThrow("fail")
    await expect(cb.execute(fail)).rejects.toThrow("fail")

    await expect(cb.execute(fail)).rejects.toThrow()
    try {
      await cb.execute(fail)
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitOpenError)
    }
  })

  it("should reset on success after half-open", async () => {
    const cb = new CircuitBreaker("test", 2, 1)

    const fail = () => Promise.reject(new Error("fail"))
    await expect(cb.execute(fail)).rejects.toThrow("fail")
    await expect(cb.execute(fail)).rejects.toThrow("fail")

    await new Promise(r => setTimeout(r, 10))

    const result = await cb.execute(() => Promise.resolve("recovered"))
    expect(result).toBe("recovered")
    expect(cb.isOpen).toBe(false)
  })

  it("should track isOpen correctly", async () => {
    const cb = new CircuitBreaker("test", 1, 60000)
    expect(cb.isOpen).toBe(false)

    await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail")
    expect(cb.isOpen).toBe(true)
  })
})

describe("searchDocsCombined — fallback behavior", () => {
  it("keyword mode returns results from seeded docs", async () => {
    seedDoc("cb-kw-1", "Circuit Breaker Patterns", ["circuit", "breaker"], "Circuit breaker is a resilience pattern for distributed systems")
    seedDoc("cb-kw-2", "Rate Limiting Guide", ["rate-limit", "throttle"], "Rate limiting prevents API overload and abuse")

    const results = searchDocs("circuit breaker")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain("Circuit")
  })

  it("combined mode returns results even when semantic search is unavailable", async () => {
    seedDoc("cb-sem-1", "Fallback Architecture", ["fallback", "architecture"], "When semantic search fails the system falls back to keyword and tfidf matching")

    const savedFetch = globalThis.fetch
    globalThis.fetch = ((() => Promise.reject(new Error("network error"))) as unknown) as typeof fetch

    try {
      const results = await searchDocsCombined("fallback architecture")
      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.title.includes("Fallback"))).toBe(true)
    } finally {
      globalThis.fetch = savedFetch
    }
  }, { timeout: 20000 })
})

describe("callLlm retry + circuit breaker integration", () => {
  it("should trigger CircuitBreaker after consecutive LLM failures", async () => {
    const cb = new CircuitBreaker("llm-retry-test", 3, 60000)

    const failFn = () => cb.execute(async () => {
      throw new Error("LLM request failed (429): rate limited")
    })

    for (let i = 0; i < 3; i++) {
      await expect(failFn()).rejects.toThrow("429")
    }

    expect(cb.isOpen).toBe(true)
    try {
      await failFn()
    } catch (e) {
      expect(e).toBeInstanceOf(CircuitOpenError)
    }
  })

  it("should recover circuit breaker after cooldown + success", async () => {
    const cb = new CircuitBreaker("llm-recover-test", 2, 1)

    await expect(cb.execute(() => Promise.reject(new Error("timeout")))).rejects.toThrow("timeout")
    await expect(cb.execute(() => Promise.reject(new Error("timeout")))).rejects.toThrow("timeout")

    await new Promise(r => setTimeout(r, 10))

    const result = await cb.execute(() => Promise.resolve("LLM response OK"))
    expect(result).toBe("LLM response OK")
    expect(cb.isOpen).toBe(false)
  })

  it("simulates 429 retry behavior", async () => {
    let callCount = 0
    const retry429 = async (): Promise<string> => {
      callCount++
      if (callCount < 3) {
        throw new Error("LLM request failed (429): rate limited")
      }
      return "success after retry"
    }

    const maxRetries = 3
    let result: string | undefined

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        result = await retry429()
        break
      } catch {
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, 10))
        }
      }
    }

    expect(result).toBe("success after retry")
    expect(callCount).toBe(3)
  })
})

describe("Embedding degradation", () => {
  it("cosineSimilarityVec should handle zero vectors", () => {
    const a = [1, 0, 0]
    const b = [0, 0, 0]
    const score = cosineSimilarityVec(a, b)
    expect(isFinite(score)).toBe(true)
  })

  it("cosineSimilarityVec should return ~1 for identical vectors", () => {
    const v = [0.5, 0.3, 0.2]
    const score = cosineSimilarityVec(v, v)
    expect(score).toBeGreaterThan(0.99)
  })

  it("cosineSimilarityVec should return ~0 for orthogonal vectors", () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    const score = cosineSimilarityVec(a, b)
    expect(Math.abs(score)).toBeLessThan(0.01)
  })

  it("semanticSearch returns empty when no docs provided", async () => {
    const results = await semanticSearch("test query", [])
    expect(results).toEqual([])
  })

  it("semanticSearch returns empty for empty query", async () => {
    const results = await semanticSearch("", [{ meta: { id: "1", title: "test", keywords: [], tags: [], intent: "test", project_description: "test" } as any, embedding: [0.1, 0.2] }])
    expect(results).toEqual([])
  })

  it.skipIf(hasTransformers)("semanticSearch returns empty when both transformers and external are unavailable", async () => {
    const savedFetch = globalThis.fetch
    globalThis.fetch = ((() => Promise.reject(new Error("unavailable"))) as unknown) as typeof fetch

    try {
      const results = await semanticSearch("test", [
        { meta: { id: "1", title: "test", keywords: [], tags: [], intent: "test", project_description: "test" } as any, embedding: [0.1] },
      ])
      expect(results).toEqual([])
    } finally {
      globalThis.fetch = savedFetch
    }
  })
})

describe("SearchPipeline degradation", () => {
  function mockSource(name: any, results: any[] = [], shouldFail = false): SearchSource {
    return {
      name,
      available: () => true,
      search: shouldFail
        ? async () => { throw new Error(`${name} failed`) }
        : async () => results,
    }
  }

  it("should return partial results when some sources fail", async () => {
    const goodSource = mockSource("tavily" as any, [
      { title: "Result A", url: "https://a.com", snippet: "good", source: "tavily" as any, sourceType: "official" as any, qualityScore: 80 },
    ])
    const badSource = mockSource("serper" as any, [], true)

    const pipeline = new SearchPipeline([goodSource, badSource], { fastTimeout: 5000, slowTimeout: 5000 })
    const result = await pipeline.search("test query")

    expect(result.results.length).toBeGreaterThanOrEqual(1)
    expect(result.results.some(r => r.title === "Result A")).toBe(true)
  })

  it("should return empty when all sources fail", async () => {
    const source1 = mockSource("tavily" as any, [], true)
    const source2 = mockSource("serper" as any, [], true)

    const pipeline = new SearchPipeline([source1, source2], { fastTimeout: 2000, slowTimeout: 2000 })
    const result = await pipeline.search("test query")

    expect(result.results.length).toBe(0)
    expect(result.totalSources).toBe(2)
  })

  it("should return hint indicating no results when all fail", async () => {
    const source = mockSource("tavily" as any, [], true)
    const pipeline = new SearchPipeline([source], { fastTimeout: 2000, slowTimeout: 2000 })
    const result = await pipeline.search("nothing")

    expect(result.hint).toContain("未找到")
  })

  it("should handle unavailable sources gracefully", async () => {
    const unavailableSource: SearchSource = {
      name: "serper" as any,
      available: () => false,
      search: async () => [],
    }
    const goodSource = mockSource("tavily" as any, [
      { title: "Only Source", url: "https://only.com", snippet: "solo", source: "tavily" as any, sourceType: "official" as any, qualityScore: 70 },
    ])

    const pipeline = new SearchPipeline([unavailableSource, goodSource], { fastTimeout: 2000, slowTimeout: 2000 })
    const result = await pipeline.search("test")

    expect(result.results.length).toBeGreaterThanOrEqual(1)
    expect(result.results[0].title).toBe("Only Source")
  })

  it("should record source timings even for failed sources", async () => {
    const badSource = mockSource("tavily" as any, [], true)
    const pipeline = new SearchPipeline([badSource], { fastTimeout: 2000, slowTimeout: 2000 })
    const result = await pipeline.search("test")

    expect(result.sourceTimings).toBeDefined()
    expect(result.sourceTimings!.length).toBe(1)
    expect(result.sourceTimings![0].error).toBeDefined()
  })
})
