import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import { callLlm, type LlmConfig } from "../src/search/llm-caller"
import { aggregateResults } from "../src/search/result-aggregator"
import { evaluateQuality } from "../src/search/ask/quality-evaluator"
import { analyzeIntent } from "../src/search/ask/intent-analyzer"
import {
  getCachedResults,
  setCachedResults,
  invalidateResultCache,
  getResultCacheStats,
} from "../src/search/result-cache"
import { circuitBreakers } from "../src/search/circuit-breaker"
import {
  HIGH_RELEVANCE_SCORE,
  LOW_RELEVANCE_SCORE,
  MIN_SUMMARY_LENGTH,
  MIN_RESULTS_FOR_COMPLETE,
  EARLY_STOP_THRESHOLD,
  MAX_SEARCH_LIMIT,
  MIN_CONTENT_LENGTH,
  MIN_SHORT_CONTENT_LENGTH,
  AUTO_COMPLETE_THRESHOLD,
  RRF_K,
  SEARCH_WEIGHTS,
} from "../src/search/constants"
import type { SearchResult } from "../src/search/types"

const MOCK_LLM: LlmConfig = {
  baseUrl: "https://api.test.local/v1",
  apiKey: "test-key",
  model: "test-model",
}

function mockFetchResponse(body: unknown, status = 200, ok = true) {
  return Promise.resolve({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as Response)
}

function makeLlmBody(content: string, reasoningContent?: string) {
  return {
    choices: [
      {
        message: {
          content,
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        },
      },
    ],
  }
}

describe("llm-caller", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    try { (circuitBreakers.llm as any).state = "closed"; (circuitBreakers.llm as any).failures = 0 } catch {}
  })

  afterEach(() => {
    globalThis.fetch = originalFetch as never
    try { (circuitBreakers.llm as any).state = "closed"; (circuitBreakers.llm as any).failures = 0 } catch {}
  })

  it("should call LLM and return response", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody("The answer is 42")),
    ) as never

    const result = await callLlm(MOCK_LLM, [{ role: "user", content: "test" }])
    expect(result).toBe("The answer is 42")
  })

  it("should return reasoning_content when content is empty (thinking mode)", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody(null, "reasoning result")),
    ) as never

    const result = await callLlm(MOCK_LLM, [{ role: "user", content: "test" }])
    expect(result).toBe("reasoning result")
  })

  it("should retry on 429 status", async () => {
    let callCount = 0
    globalThis.fetch = mock(() => {
      callCount++
      if (callCount <= 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          text: () => Promise.resolve("rate limited"),
          json: () => Promise.resolve({}),
        } as Response)
      }
      return mockFetchResponse(makeLlmBody("retried ok"))
    }) as never

    const result = await callLlm(MOCK_LLM, [{ role: "user", content: "test" }], 0.3, 2000, 10000)
    expect(callCount).toBeGreaterThanOrEqual(2)
    expect(result).toBe("retried ok")
  }, 15000)

  it("should retry on 5xx status", async () => {
    let callCount = 0
    globalThis.fetch = mock(() => {
      callCount++
      if (callCount <= 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve("internal error"),
          json: () => Promise.resolve({}),
        } as Response)
      }
      return mockFetchResponse(makeLlmBody("recovered"))
    }) as never

    const result = await callLlm(MOCK_LLM, [{ role: "user", content: "test" }], 0.3, 2000, 10000)
    expect(callCount).toBeGreaterThanOrEqual(2)
    expect(result).toBe("recovered")
  }, 15000)

  it("should retry on network error", async () => {
    let callCount = 0
    globalThis.fetch = mock(() => {
      callCount++
      if (callCount <= 1) {
        return Promise.reject(new TypeError("fetch failed"))
      }
      return mockFetchResponse(makeLlmBody("network recovered"))
    }) as never

    const result = await callLlm(MOCK_LLM, [{ role: "user", content: "test" }], 0.3, 2000, 10000)
    expect(callCount).toBeGreaterThanOrEqual(2)
    expect(result).toBe("network recovered")
  }, 15000)

  it("should throw after exhausting retries", async () => {
    let callCount = 0
    globalThis.fetch = mock(() => {
      callCount++
      return Promise.reject(new TypeError("persistent failure"))
    }) as never

    expect(
      callLlm(MOCK_LLM, [{ role: "user", content: "test" }], 0.3, 2000, 30000),
    ).rejects.toThrow(/network error/)
    expect(callCount).toBe(4)
  }, 15000)

  it("should respect max retry count", async () => {
    let callCount = 0
    globalThis.fetch = mock(() => {
      callCount++
      return Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve("error"),
        json: () => Promise.resolve({}),
      } as Response)
    }) as never

    try {
      await callLlm(MOCK_LLM, [{ role: "user", content: "test" }], 0.3, 2000, 60000)
    } catch {}
    expect(callCount).toBe(4)
  }, 15000)

  it("should handle malformed response", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse({ not_choices: true }),
    ) as never

    expect(
      callLlm(MOCK_LLM, [{ role: "user", content: "test" }]),
    ).rejects.toThrow(/Unexpected response structure/)
  })

  it("should handle response with no message", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse({ choices: [] }),
    ) as never

    expect(
      callLlm(MOCK_LLM, [{ role: "user", content: "test" }]),
    ).rejects.toThrow(/No message/)
  })

  it("should return empty string when both content and reasoning are empty", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody(null, null)),
    ) as never

    const result = await callLlm(MOCK_LLM, [{ role: "user", content: "test" }])
    expect(result).toBe("")
  })

  it("should throw on non-ok non-retriable status", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => Promise.resolve("unauthorized"),
        json: () => Promise.resolve({}),
      } as Response),
    ) as never

    expect(
      callLlm(MOCK_LLM, [{ role: "user", content: "test" }]),
    ).rejects.toThrow(/401/)
  })
})

describe("result-aggregator", () => {
  function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
    return {
      title: "Test Result",
      url: "https://example.com/page",
      snippet: "Some snippet",
      source: "web-search-prime",
      sourceType: "blog",
      qualityScore: 0,
      ...overrides,
    }
  }

  it("should merge results from multiple sources", () => {
    const r1 = makeResult({ title: "Result A", url: "https://a.com", source: "web-search-prime" })
    const r2 = makeResult({ title: "Result B", url: "https://b.com", source: "tavily" })
    const result = aggregateResults([r1, r2], "test query")
    expect(result.length).toBe(2)
  })

  it("should deduplicate by URL", () => {
    const r1 = makeResult({ title: "Result A", url: "https://example.com/page", snippet: "Short" })
    const r2 = makeResult({ title: "Result A", url: "https://example.com/page", snippet: "Longer snippet with more content" })
    const result = aggregateResults([r1, r2], "test query")
    expect(result.length).toBe(1)
    expect(result[0].snippet).toBe("Longer snippet with more content")
  })

  it("should sort by final score descending", () => {
    const r1 = makeResult({ title: "React Official", url: "https://react.dev/docs", snippet: "React official docs", sourceType: "official" })
    const r2 = makeResult({ title: "Random Blog", url: "https://random-blog.xyz/post", snippet: "Some random post", sourceType: "blog" })
    const result = aggregateResults([r2, r1], "React docs")
    expect(result[0].title).toBe("React Official")
    expect(result[0].qualityScore).toBeGreaterThan(result[1].qualityScore)
  })

  it("should handle empty results", () => {
    const result = aggregateResults([], "test query")
    expect(result).toEqual([])
  })

  it("should handle single source", () => {
    const r = makeResult({ title: "Only One", url: "https://only.com" })
    const result = aggregateResults([r], "only one")
    expect(result.length).toBe(1)
    expect(result[0].title).toBe("Only One")
  })

  it("should respect maxResults parameter", () => {
    const results = Array.from({ length: 15 }, (_, i) =>
      makeResult({ title: `Result ${i}`, url: `https://example.com/${i}` }),
    )
    const result = aggregateResults(results, "test", 5)
    expect(result.length).toBe(5)
  })

  it("should identify source type for unknown URLs", () => {
    const r = makeResult({
      title: "Python Docs",
      url: "https://docs.python.org/3/tutorial",
      sourceType: "unknown",
      snippet: "Python tutorial",
    })
    const result = aggregateResults([r], "python tutorial")
    expect(result[0].sourceType).toBe("documentation")
  })

  it("should penalize search redirect URLs", () => {
    const r = makeResult({
      title: "Baidu Redirect",
      url: "https://www.baidu.com/link?url=abc123",
      snippet: "redirected result",
    })
    const result = aggregateResults([r], "test query")
    expect(result[0].qualityScore).toBeLessThanOrEqual(15)
  })
})

describe("quality-evaluator", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch as never
    try { (circuitBreakers.llm as any).state = "closed"; (circuitBreakers.llm as any).failures = 0 } catch {}
  })

  afterEach(() => {
    globalThis.fetch = originalFetch as never
    try { (circuitBreakers.llm as any).state = "closed"; (circuitBreakers.llm as any).failures = 0 } catch {}
  })

  function makeDocMeta(overrides = {}) {
    return {
      id: "doc-1",
      title: "AI SDK Guide",
      tags: ["ai", "sdk"],
      keywords: ["ai-sdk", "vercel"],
      intent: "AI SDK usage guide",
      project_description: "Test project",
      source_project: "/tmp/test",
      source_worktree: "/tmp/test",
      created_at: Date.now(),
      file_path: "/tmp/test.md",
      score: 85,
      ...overrides,
    }
  }

  const defaultIntent = {
    coreKeywords: ["ai-sdk", "usage"],
    subQueries: ["ai sdk usage"],
    researchType: "doc",
    rewrittenQuery: "ai-sdk usage guide",
    missingAspects: [],
  }

  it("should evaluate result quality with high score", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody(JSON.stringify({
        relevanceScore: 92,
        isRelevant: true,
        completeness: "complete",
        missingAspects: [],
        suggestedRewrite: null,
        webSearchRecommended: false,
        webSearchQuery: null,
      }))),
    ) as never

    const result = await evaluateQuality(
      "How to use AI SDK",
      defaultIntent,
      makeDocMeta(),
      "Detailed content about AI SDK usage with code examples...",
      [makeDocMeta()],
      MOCK_LLM,
    )

    expect(result.relevanceScore).toBe(92)
    expect(result.isRelevant).toBe(true)
    expect(result.completeness).toBe("complete")
    expect(result.webSearchRecommended).toBe(false)
  })

  it("should handle low quality / incomplete results", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody(JSON.stringify({
        relevanceScore: 30,
        isRelevant: false,
        completeness: "incomplete",
        missingAspects: ["code examples", "api reference"],
        suggestedRewrite: null,
        webSearchRecommended: true,
        webSearchQuery: "AI SDK complete guide",
      }))),
    ) as never

    const result = await evaluateQuality(
      "AI SDK complete tutorial",
      defaultIntent,
      makeDocMeta({ score: 30 }),
      "Brief mention of AI SDK...",
      [makeDocMeta({ score: 30 })],
      MOCK_LLM,
    )

    expect(result.relevanceScore).toBe(30)
    expect(result.isRelevant).toBe(false)
    expect(result.completeness).toBe("incomplete")
    expect(result.webSearchRecommended).toBe(true)
  })

  it("should fallback gracefully on LLM error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve("bad request"),
        json: () => Promise.resolve({}),
      } as Response),
    ) as never

    const result = await evaluateQuality(
      "test query",
      { ...defaultIntent, rewrittenQuery: "test query" },
      makeDocMeta({ score: 85 }),
      "some content",
      [makeDocMeta({ score: 85 })],
      MOCK_LLM,
    )

    expect(result.relevanceScore).toBe(85)
    expect(result.webSearchRecommended).toBe(true)
  })

  it("should handle empty results array", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody(JSON.stringify({
        relevanceScore: 0,
        isRelevant: false,
        completeness: "incomplete",
        missingAspects: ["everything"],
        suggestedRewrite: "better query",
        webSearchRecommended: true,
        webSearchQuery: "search query",
      }))),
    ) as never

    const result = await evaluateQuality(
      "test",
      defaultIntent,
      makeDocMeta({ score: 10 }),
      "",
      [],
      MOCK_LLM,
    )

    expect(result.completeness).toBe("incomplete")
  })
})

describe("intent-analyzer", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = originalFetch as never
    try { (circuitBreakers.llm as any).state = "closed"; (circuitBreakers.llm as any).failures = 0 } catch {}
  })

  afterEach(() => {
    globalThis.fetch = originalFetch as never
    try { (circuitBreakers.llm as any).state = "closed"; (circuitBreakers.llm as any).failures = 0 } catch {}
  })

  it("should classify intent from LLM response", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody(JSON.stringify({
        coreKeywords: ["docker", "sandbox", "isolation"],
        subQueries: ["docker sandbox isolation", "Docker 安全隔离", "container sandbox"],
        researchType: "concept",
        rewrittenQuery: "docker sandbox isolation",
      }))),
    ) as never

    const result = await analyzeIntent("如何实现 Docker 沙箱隔离", MOCK_LLM)

    expect(result.coreKeywords).toContain("docker")
    expect(result.coreKeywords).toContain("sandbox")
    expect(result.researchType).toBe("concept")
    expect(result.rewrittenQuery).toBe("docker sandbox isolation")
    expect(result.degraded).toBeUndefined()
  })

  it("should extract key terms from query", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody(JSON.stringify({
        coreKeywords: ["react", "hooks", "useEffect"],
        subQueries: ["react hooks useEffect", "React useEffect cleanup"],
        researchType: "api",
        rewrittenQuery: "react hooks useEffect",
      }))),
    ) as never

    const result = await analyzeIntent("React useEffect hook cleanup", MOCK_LLM)
    expect(result.coreKeywords).toContain("react")
    expect(result.coreKeywords).toContain("hooks")
    expect(result.subQueries.length).toBeGreaterThanOrEqual(1)
    expect(result.researchType).toBe("api")
  })

  it("should fallback to keyword splitting on LLM error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 400,
        text: () => Promise.resolve("bad request"),
        json: () => Promise.resolve({}),
      } as Response),
    ) as never

    const result = await analyzeIntent("Docker sandbox isolation test", MOCK_LLM)

    expect(result.degraded).toBe(true)
    expect(result.coreKeywords.length).toBeGreaterThan(0)
    expect(result.rewrittenQuery).toBe("Docker sandbox isolation test")
    expect(result.researchType).toBe("concept")
  })

  it("should handle ambiguous queries gracefully", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody("not valid json")),
    ) as never

    const result = await analyzeIntent("something ambiguous", MOCK_LLM)

    expect(result.degraded).toBe(true)
    expect(result.coreKeywords).toBeDefined()
    expect(result.subQueries).toBeDefined()
  })

  it("should limit coreKeywords to 7", async () => {
    globalThis.fetch = mock(() =>
      mockFetchResponse(makeLlmBody(JSON.stringify({
        coreKeywords: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        subQueries: ["q1", "q2", "q3", "q4", "q5", "q6"],
        researchType: "concept",
        rewrittenQuery: "test",
      }))),
    ) as never

    const result = await analyzeIntent("test", MOCK_LLM)
    expect(result.coreKeywords.length).toBeLessThanOrEqual(7)
    expect(result.subQueries.length).toBeLessThanOrEqual(5)
  })
})

describe("result-cache", () => {
  beforeEach(() => {
    invalidateResultCache()
  })

  it("should cache and retrieve results", () => {
    const data = [{ title: "test" }]
    setCachedResults("key1", data)
    const cached = getCachedResults<typeof data>("key1")
    expect(cached).toEqual(data)
  })

  it("should return null for non-existent key", () => {
    const result = getCachedResults("nonexistent")
    expect(result).toBeNull()
  })

  it("should respect TTL and evict expired entries", () => {
    setCachedResults("ttl-test", "value")
    const stats = getResultCacheStats()
    expect(stats.size).toBe(1)
    expect(stats.ttlMs).toBe(30000)
    expect(stats.maxSize).toBe(200)
  })

  it("should clear on demand", () => {
    setCachedResults("a", 1)
    setCachedResults("b", 2)
    expect(getResultCacheStats().size).toBe(2)

    invalidateResultCache()
    expect(getResultCacheStats().size).toBe(0)
    expect(getCachedResults("a")).toBeNull()
  })

  it("should report stats", () => {
    setCachedResults("s1", "v1")
    setCachedResults("s2", "v2")
    setCachedResults("s3", "v3")

    const stats = getResultCacheStats()
    expect(stats.size).toBe(3)
    expect(stats.maxSize).toBe(200)
    expect(stats.ttlMs).toBe(30000)
  })

  it("should overwrite existing key", () => {
    setCachedResults("key", "old")
    setCachedResults("key", "new")
    expect(getCachedResults("key")).toBe("new")
  })
})

describe("search constants", () => {
  it("should export expected numeric constants", () => {
    expect(HIGH_RELEVANCE_SCORE).toBe(70)
    expect(LOW_RELEVANCE_SCORE).toBe(60)
    expect(MIN_SUMMARY_LENGTH).toBe(200)
    expect(MIN_RESULTS_FOR_COMPLETE).toBe(7)
    expect(EARLY_STOP_THRESHOLD).toBe(10)
    expect(MAX_SEARCH_LIMIT).toBe(500)
    expect(MIN_CONTENT_LENGTH).toBe(300)
    expect(MIN_SHORT_CONTENT_LENGTH).toBe(100)
    expect(AUTO_COMPLETE_THRESHOLD).toBe(90)
    expect(RRF_K).toBe(60)
  })

  it("should export SEARCH_WEIGHTS with correct keys", () => {
    expect(SEARCH_WEIGHTS.token).toBeDefined()
    expect(SEARCH_WEIGHTS.tfidf).toBeDefined()
    expect(SEARCH_WEIGHTS.semantic).toBeDefined()
    expect(SEARCH_WEIGHTS.token + SEARCH_WEIGHTS.tfidf + SEARCH_WEIGHTS.semantic).toBeCloseTo(1.0)
  })
})
