import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import {
  buildFallbackSummary,
  calibrateScore,
  appendReferences,
  buildResult,
} from "../src/research/research-agent-result"
import { expandQuery } from "../src/chat/query-expander"
import { buildSpawnEnv, gitEnv, codegraphEnv, curlEnv } from "../src/utils/spawn-env"
import type { DeepReadItem } from "../src/research/types"
import type { SearchResult } from "../src/search/types"

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: "Test Result",
    url: "https://example.com",
    snippet: "This is a test snippet with some content.",
    source: "web-search-prime",
    sourceType: "blog",
    qualityScore: 0.8,
    ...overrides,
  }
}

function makeDeepRead(overrides: Partial<DeepReadItem> = {}): DeepReadItem {
  return {
    title: "Deep Read Title",
    url: "https://example.com/deep",
    content: "Line 1 with enough characters to pass filter.\nLine 2 with enough characters to pass filter.\nLine 3 with enough characters to pass filter.\nLine 4 with enough characters to pass filter.\nLine 5 with enough characters to pass filter.",
    success: true,
    source: "url-fetch",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// research-agent-result
// ---------------------------------------------------------------------------
describe("research-agent-result", () => {
  describe("buildFallbackSummary", () => {
    it("should summarize from deep read results", () => {
      const dr = [makeDeepRead({ title: "Article 1" })]
      const result = buildFallbackSummary("test", dr, [])
      expect(result).toContain("### [1] Article 1")
      expect(result).toContain("Source: https://example.com/deep")
    })

    it("should use Chinese source label for Chinese queries", () => {
      const dr = [makeDeepRead()]
      const result = buildFallbackSummary("测试查询", dr, [])
      expect(result).toContain("来源:")
    })

    it("should summarize from search results when no deep reads", () => {
      const sr = [makeSearchResult({ title: "Search Hit" })]
      const result = buildFallbackSummary("test", [], sr)
      expect(result).toContain("[1] **Search Hit**")
      expect(result).toContain("https://example.com")
    })

    it("should handle empty results", () => {
      const result = buildFallbackSummary("test", [], [])
      expect(result).toBeTruthy()
    })

    it("should filter out failed deep reads", () => {
      const dr = [makeDeepRead({ success: false, title: "Bad" }), makeDeepRead({ success: true, title: "Good One" })]
      const result = buildFallbackSummary("test", dr, [])
      expect(result).not.toContain("Bad")
      expect(result).toContain("### [1] Good One")
    })

    it("should limit deep read content to 800 chars and 5 lines", () => {
      const longContent = Array.from({ length: 20 }, (_, i) => `Line number ${i} with enough characters to pass the minimum filter threshold.`).join("\n")
      const dr = [makeDeepRead({ content: longContent })]
      const result = buildFallbackSummary("test", dr, [])
      const contentLines = result.split("\n").filter(l => l.startsWith("Line number"))
      expect(contentLines.length).toBeLessThanOrEqual(5)
    })

    it("should limit search results to 10", () => {
      const sr = Array.from({ length: 15 }, (_, i) => makeSearchResult({ title: `Result ${i}` }))
      const result = buildFallbackSummary("test", [], sr)
      const matches = result.match(/\[\d+\]/g)
      expect(matches).toHaveLength(10)
    })
  })

  describe("calibrateScore", () => {
    it("should give base scores for minimal content", () => {
      const { quality, coverage } = calibrateScore("short", [])
      expect(quality).toBeGreaterThanOrEqual(3)
      expect(coverage).toBeGreaterThanOrEqual(3)
    })

    it("should increase quality for longer content", () => {
      const short = calibrateScore("short text", [])
      const long = calibrateScore("x".repeat(7000), [])
      expect(long.quality).toBeGreaterThan(short.quality)
    })

    it("should increase quality for high deep-read success rate", () => {
      const noDr = calibrateScore("text", [])
      const goodDr = calibrateScore("text", Array.from({ length: 6 }, () => makeDeepRead({ success: true })))
      expect(goodDr.quality).toBeGreaterThan(noDr.quality)
    })

    it("should increase coverage for headings", () => {
      const plain = calibrateScore("no headings here", [])
      const withHeadings = calibrateScore("## H2\n### H3\n## H2\n### H3\n## H2\n### H3\n## H2\ncontent", [])
      expect(withHeadings.coverage).toBeGreaterThanOrEqual(plain.coverage)
    })

    it("should increase coverage for code blocks", () => {
      const noCode = calibrateScore("plain text", [])
      const withCode = calibrateScore("some text ```ts\ncode\n``` more", [])
      expect(withCode.coverage).toBeGreaterThanOrEqual(noCode.coverage)
    })

    it("should increase coverage for tables", () => {
      const noTable = calibrateScore("plain", [])
      const withTable = calibrateScore("| a |\n|---|\n| b |", [])
      expect(withTable.coverage).toBeGreaterThanOrEqual(noTable.coverage)
    })

    it("should increase coverage for citations", () => {
      const noCite = calibrateScore("plain", [])
      const withCite = calibrateScore("text [1] [2] [3] [4] end", [])
      expect(withCite.coverage).toBeGreaterThanOrEqual(noCite.coverage)
    })

    it("should cap quality and coverage at 10", () => {
      const { quality, coverage } = calibrateScore("x".repeat(10000), Array.from({ length: 10 }, () => makeDeepRead({ success: true })))
      expect(quality).toBeLessThanOrEqual(10)
      expect(coverage).toBeLessThanOrEqual(10)
    })

    it("should cap low for short content", () => {
      const { quality, coverage } = calibrateScore("short", [])
      expect(quality).toBeLessThanOrEqual(4)
      expect(coverage).toBeLessThanOrEqual(3)
    })
  })

  describe("appendReferences", () => {
    it("should append references section", () => {
      const dr = [makeDeepRead({ title: "Ref1", url: "https://a.com" })]
      const result = appendReferences("summary text", dr, [])
      expect(result).toContain("## 参考资料")
      expect(result).toContain("[Ref1](https://a.com)")
    })

    it("should include search results as additional refs", () => {
      const sr = [makeSearchResult({ title: "SearchRef", url: "https://b.com" })]
      const result = appendReferences("summary", [], sr)
      expect(result).toContain("[SearchRef](https://b.com)")
    })

    it("should not duplicate references if already present", () => {
      const summary = "summary\n## 参考资料\nexisting"
      const result = appendReferences(summary, [makeDeepRead()], [])
      expect(result).toBe(summary)
    })

    it("should return summary unchanged when no sources", () => {
      const result = appendReferences("just summary", [], [])
      expect(result).toBe("just summary")
    })

    it("should limit to 10 sources", () => {
      const dr = Array.from({ length: 8 }, (_, i) => makeDeepRead({ title: `D${i}`, url: `https://d${i}.com` }))
      const sr = Array.from({ length: 5 }, (_, i) => makeSearchResult({ title: `S${i}`, url: `https://s${i}.com` }))
      const result = appendReferences("summary", dr, sr)
      const refLines = result.split("\n").filter(l => l.startsWith("- ["))
      expect(refLines.length).toBeLessThanOrEqual(10)
    })
  })

  describe("buildResult", () => {
    it("should build a complete ResearchResult", () => {
      const dr = [makeDeepRead()]
      const sr = [makeSearchResult()]
      const result = buildResult(
        "test query",
        "standard",
        dr, sr,
        [], [],
        Date.now(),
        7, 6,
        "outline text",
        "summary text",
        false,
      )
      expect(result.query).toBe("test query")
      expect(result.mode).toBe("standard")
      expect(result.summary).toContain("summary text")
      expect(result.summary).toContain("参考资料")
      expect(result.sources).toHaveLength(1)
      expect(result.searchResults).toHaveLength(1)
      expect(result.summaryFallback).toBe(false)
      expect(result.finalQualityScore).toBeGreaterThan(0)
      expect(result.finalCoverageScore).toBeGreaterThan(0)
    })

    it("should use calibrated scores when system score is 0", () => {
      const result = buildResult("q", "quick", [], [], [], [], Date.now(), 0, 0, "", "summary", true)
      expect(result.finalQualityScore).toBeGreaterThan(0)
      expect(result.summaryFallback).toBe(true)
    })

    it("should clamp system score to calibrated +/- 2", () => {
      const result = buildResult("q", "quick", [], [], [], [], Date.now(), 10, 10, "", "short", false)
      expect(result.finalQualityScore).toBeLessThanOrEqual(10)
    })
  })
})

// ---------------------------------------------------------------------------
// query-expander
// ---------------------------------------------------------------------------
describe("query-expander", () => {
  it("should expand simple queries", () => {
    const results = expandQuery("react")
    expect(results.length).toBeGreaterThan(0)
    expect(results).toContain("react")
  })

  it("should generate variations with synonyms", () => {
    const results = expandQuery("react")
    expect(results).toContain("React")
    expect(results).toContain("reactjs")
  })

  it("should handle CJK queries", () => {
    const results = expandQuery("前端框架")
    expect(results.length).toBeGreaterThan(0)
    expect(results).toContain("前端框架")
  })

  it("should handle empty input", () => {
    expect(expandQuery("")).toEqual([])
    expect(expandQuery("   ")).toEqual([])
  })

  it("should correct typos", () => {
    const results = expandQuery("reacct hooks")
    expect(results.some(r => r.includes("react"))).toBe(true)
  })

  it("should map Chinese terms to English synonyms", () => {
    const results = expandQuery("前端框架")
    expect(results.some(r => r.toLowerCase().includes("react") || r.toLowerCase().includes("spa"))).toBe(true)
  })

  it("should limit to 15 results", () => {
    const results = expandQuery("react vue typescript docker")
    expect(results.length).toBeLessThanOrEqual(15)
  })

  it("should put original query first", () => {
    const results = expandQuery("vite")
    expect(results[0]).toBe("vite")
  })

  it("should expand deploy-related queries", () => {
    const results = expandQuery("部署")
    expect(results.some(r => r.includes("deploy") || r.includes("发布"))).toBe(true)
  })

  it("should handle mixed CJK and English", () => {
    const results = expandQuery("typescript 类型系统")
    expect(results.length).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// spawn-env
// ---------------------------------------------------------------------------
describe("spawn-env", () => {
  it("should include PATH and HOME", () => {
    const env = buildSpawnEnv()
    expect(env.PATH).toBeTruthy()
    expect(env.HOME).toBeTruthy()
  })

  it("should accept extra env vars", () => {
    const env = buildSpawnEnv({ MY_VAR: "hello" })
    expect(env.MY_VAR).toBe("hello")
    expect(env.PATH).toBeTruthy()
  })

  it("should not leak API keys from process.env", () => {
    const env = buildSpawnEnv()
    const dangerousKeys = Object.keys(env).filter(k =>
      /api[_-]?key|secret|token|password|auth/i.test(k)
    )
    expect(dangerousKeys).toEqual([])
  })

  it("gitEnv should set GIT_TERMINAL_PROMPT=0", () => {
    const env = gitEnv()
    expect(env.GIT_TERMINAL_PROMPT).toBe("0")
    expect(env.PATH).toBeTruthy()
  })

  it("codegraphEnv should return base env", () => {
    const env = codegraphEnv()
    expect(env.PATH).toBeTruthy()
    expect(env.HOME).toBeTruthy()
  })

  it("curlEnv should include proxy if set", () => {
    const origProxy = process.env.https_proxy
    process.env.https_proxy = "http://proxy:8080"
    try {
      const env = curlEnv()
      expect(env.https_proxy).toBe("http://proxy:8080")
    } finally {
      if (origProxy) process.env.https_proxy = origProxy
      else delete process.env.https_proxy
    }
  })

  it("curlEnv should not include proxy if not set", () => {
    const origProxy = process.env.https_proxy
    const origHttp = process.env.http_proxy
    const origAll = process.env.all_proxy
    const origHttpsUpper = process.env.HTTPS_PROXY
    const origHttpUpper = process.env.HTTP_PROXY
    const origAllUpper = process.env.ALL_PROXY
    delete process.env.https_proxy
    delete process.env.http_proxy
    delete process.env.all_proxy
    delete process.env.HTTPS_PROXY
    delete process.env.HTTP_PROXY
    delete process.env.ALL_PROXY
    try {
      const env = curlEnv()
      expect(env.https_proxy).toBeUndefined()
      expect(env.http_proxy).toBeUndefined()
    } finally {
      if (origProxy) process.env.https_proxy = origProxy
      if (origHttp) process.env.http_proxy = origHttp
      if (origAll) process.env.all_proxy = origAll
      if (origHttpsUpper) process.env.HTTPS_PROXY = origHttpsUpper
      if (origHttpUpper) process.env.HTTP_PROXY = origHttpUpper
      if (origAllUpper) process.env.ALL_PROXY = origAllUpper
    }
  })
})
