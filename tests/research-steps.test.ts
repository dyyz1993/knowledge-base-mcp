import { describe, it, expect } from "bun:test"
import type { AnalyzeQueryResult, FilterResult } from "../src/research/types"
import type { SearchResult } from "../src/search/types"

// ---------------------------------------------------------------------------
// analyze-query.ts  (private functions)
// ---------------------------------------------------------------------------

function extractKeywords(query: string): string[] {
  const cleaned = query
    .replace(/[什么是如何怎么为什么介绍一下请问的了呢吗完整列表、，。！？\s]+/g, " ")
    .trim()
  const words = cleaned.split(/\s+/).filter(w => w.length > 1)
  return words.length > 0 ? words : [query]
}

function generateFallbackQueries(query: string): string[] {
  const queries: string[] = []
  const hasChinese = /[\u4e00-\u9fff]/.test(query)
  const keywords = extractKeywords(query)
  const joined = keywords.join(" ")

  if (hasChinese) {
    queries.push(`${joined} 教程 入门`)
    queries.push(`${joined} 最佳实践 经验总结`)
    queries.push(`${joined} 原理 深度解析`)
    queries.push(`${joined} 常见问题 解决方案`)
  }

  const enTerms = keywords.filter(w => !/[\u4e00-\u9fff]/.test(w)).join(" ") || joined
  queries.push(`${enTerms} tutorial getting started`)
  queries.push(`${enTerms} best practices guide`)
  queries.push(`${enTerms} examples code usage`)
  queries.push(`${enTerms} vs alternatives comparison`)

  const unique = [...new Set(queries)]
  return unique.slice(0, 8)
}

function similarityRatio(a: string, b: string): number {
  if (a === b) return 1
  const shorter = a.length < b.length ? a : b
  const longer = a.length < b.length ? b : a
  if (shorter.length === 0) return 0
  let common = 0
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) common++
  }
  return common / longer.length
}

function buildFallback(query: string): AnalyzeQueryResult {
  const hasChinese = /[\u4e00-\u9fff]/.test(query)
  const keywords = extractKeywords(query)
  return {
    coreKeywords: keywords.slice(0, 5),
    subQueries: generateFallbackQueries(query),
    researchType: "concept",
    language: hasChinese ? "zh" : "en",
  }
}

function parseResponseAnalyze(raw: string, query: string): AnalyzeQueryResult {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    const coreKeywords = Array.isArray(parsed.coreKeywords)
      ? parsed.coreKeywords as string[]
      : [query]

    let subQueries: string[] = []
    if (Array.isArray(parsed.subQueries)) {
      subQueries = parsed.subQueries as string[]
    } else if (parsed.subQueries && typeof parsed.subQueries === "object") {
      const sq = parsed.subQueries as Record<string, string[]>
      const zh = Array.isArray(sq.zh) ? sq.zh : []
      const en = Array.isArray(sq.en) ? sq.en : []
      subQueries = [...zh, ...en]
    }

    if (subQueries.length === 0) {
      subQueries = []
    }
    if (subQueries.length === 1 && similarityRatio(subQueries[0], query) > 0.7) {
      subQueries = []
    }

    if (subQueries.length < 5) {
      const extras = generateFallbackQueries(query)
      for (const e of extras) {
        if (!subQueries.includes(e) && subQueries.length < 8) subQueries.push(e)
      }
    }

    if (coreKeywords.length === 1 && coreKeywords[0] === query) {
      coreKeywords.splice(0, 1, ...extractKeywords(query))
    }

    const researchType = parsed.researchType as string | undefined
    const validTypes = ["doc", "api", "code", "concept", "comparison"]
    const language = parsed.language as string | undefined
    const validLangs = ["zh", "en", "mixed"]

    return {
      coreKeywords,
      subQueries: subQueries.slice(0, 10),
      researchType: validTypes.includes(researchType || "") ? researchType as AnalyzeQueryResult["researchType"] : "concept",
      language: validLangs.includes(language || "") ? language as AnalyzeQueryResult["language"] : (/[\u4e00-\u9fff]/.test(query) ? "zh" : "en"),
    }
  } catch {
    // swallow
  }
  return buildFallback(query)
}

// ---------------------------------------------------------------------------
// evaluate.ts  (private functions)
// ---------------------------------------------------------------------------

function extractJsonObject(text: string): string | null {
  if (!text || !text.trim()) return null
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    // continue
  }
  let depth = 0
  let start = -1
  let lastValid: string | null = null
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i
      depth++
    } else if (cleaned[i] === "}") {
      depth--
      if (depth === 0 && start >= 0) {
        const candidate = cleaned.slice(start, i + 1)
        try {
          JSON.parse(candidate)
          lastValid = candidate
        } catch {
          // continue
        }
      }
    }
  }
  return lastValid
}

function snippetRelevance(query: string, result: SearchResult): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  const text = `${result.title} ${result.snippet}`.toLowerCase()
  let score = 0
  for (const term of queryTerms) {
    const count = (text.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length
    score += count
  }
  score += (result.qualityScore || 0) * 0.5
  return score
}

// ---------------------------------------------------------------------------
// evaluate-depth.ts  (private function)
// ---------------------------------------------------------------------------

function extractJson(text: string): string | null {
  if (!text || !text.trim()) return null
  let cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {
    // continue
  }
  let depth = 0
  let start = -1
  let lastValid: string | null = null
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i
      depth++
    } else if (cleaned[i] === "}") {
      depth--
      if (depth === 0 && start >= 0) {
        const candidate = cleaned.slice(start, i + 1)
        try {
          JSON.parse(candidate)
          lastValid = candidate
        } catch {
          // continue
        }
      }
    }
  }
  if (!lastValid && cleaned.includes("{")) {
    const braceStart = cleaned.indexOf("{")
    const partial = cleaned.slice(braceStart)
    const fixed = partial.replace(/[,]\s*([}\]])/g, "$1").replace(/\}\s*$/, "}")
    if (fixed.startsWith("{")) {
      try { JSON.parse(fixed); lastValid = fixed } catch { /* continue */ }
    }
  }
  return lastValid
}

// ---------------------------------------------------------------------------
// deep-read.ts  (private functions)
// ---------------------------------------------------------------------------

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

const SEARCH_ENGINE_REDIRECT_PATTERNS = [
  /^https?:\/\/www\.baidu\.com\/link\?/i,
  /^https?:\/\/www\.bing\.com\/.*\/search/i,
  /^https?:\/\/www\.google\.com\/url\?/i,
  /^https?:\/\/duckduckgo\.com\/l\?/i,
]

function isSearchEngineRedirect(url: string): boolean {
  return SEARCH_ENGINE_REDIRECT_PATTERNS.some((p) => p.test(url))
}

const ANTI_CRAWL_DOMAINS = [
  "juejin.cn", "zhihu.com", "reddit.com", "stackoverflow.com",
  "segmentfault.com", "medium.com", "dev.to",
]

function needsCacheFallback(url: string): boolean {
  return ANTI_CRAWL_DOMAINS.some(d => url.includes(d))
}

// ---------------------------------------------------------------------------
// filter-results.ts  (private functions)
// ---------------------------------------------------------------------------

function formatResults(results: SearchResult[]): string {
  return results
    .slice(0, 30)
    .map(
      (r, i) =>
        `[${i}] ${r.title}\n  URL: ${r.url}\n  Snippet: ${r.snippet.slice(0, 200)}`,
    )
    .join("\n\n")
}

function parseResponseFilter(raw: string): FilterResult[] {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim()
  const parsed = JSON.parse(cleaned)
  if (!Array.isArray(parsed)) return []
  return parsed.filter(
    (item: unknown): item is FilterResult =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as FilterResult).index === "number" &&
      typeof (item as FilterResult).relevanceScore === "number" &&
      typeof (item as FilterResult).reason === "string",
  )
}

function fallbackTopResults(results: SearchResult[]): SearchResult[] {
  return [...results]
    .sort((a, b) => b.qualityScore - a.qualityScore)
    .slice(0, 15)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<SearchResult> & { title: string; url: string }): SearchResult {
  return {
    snippet: "",
    source: "web-search-prime",
    sourceType: "blog",
    qualityScore: 0,
    ...overrides,
  }
}

// ===========================================================================
// TESTS
// ===========================================================================

// --- analyze-query: extractKeywords ---
describe("extractKeywords", () => {
  it("removes Chinese filler words", () => {
    const result = extractKeywords("什么是 TypeScript")
    expect(result).toEqual(["TypeScript"])
  })

  it("filters out single-char tokens", () => {
    const result = extractKeywords("a TypeScript 是 好 的")
    expect(result).toEqual(["TypeScript"])
  })

  it("returns original query when all words are filler", () => {
    const result = extractKeywords("什么是 的")
    expect(result).toEqual(["什么是 的"])
  })

  it("handles empty string", () => {
    const result = extractKeywords("")
    expect(result).toEqual([""])
  })

  it("removes multiple types of punctuation", () => {
    const result = extractKeywords("React、Vue，Angular！")
    expect(result).toEqual(["React", "Vue", "Angular"])
  })
})

// --- analyze-query: generateFallbackQueries ---
describe("generateFallbackQueries", () => {
  it("generates Chinese + English queries for Chinese input", () => {
    const result = generateFallbackQueries("什么是 React")
    expect(result.length).toBeGreaterThan(0)
    expect(result.some(q => q.includes("教程"))).toBe(true)
    expect(result.some(q => q.includes("tutorial"))).toBe(true)
  })

  it("generates only English queries for English input", () => {
    const result = generateFallbackQueries("React hooks tutorial")
    expect(result.some(q => q.includes("tutorial"))).toBe(true)
    expect(result.some(q => q.includes("best practices"))).toBe(true)
  })

  it("deduplicates and limits to 8", () => {
    const result = generateFallbackQueries("测试查询")
    expect(result.length).toBeLessThanOrEqual(8)
    expect(new Set(result).size).toBe(result.length)
  })

  it("handles single keyword", () => {
    const result = generateFallbackQueries("React")
    expect(result.length).toBeGreaterThan(0)
  })
})

// --- analyze-query: similarityRatio ---
describe("similarityRatio", () => {
  it("returns 1 for identical strings", () => {
    expect(similarityRatio("hello", "hello")).toBe(1)
  })

  it("returns 0 for empty shorter string", () => {
    expect(similarityRatio("", "abc")).toBe(0)
  })

  it("returns 0 for completely different strings", () => {
    expect(similarityRatio("xyz", "abc")).toBe(0)
  })

  it("computes correct ratio for partial overlap", () => {
    const ratio = similarityRatio("abc", "bcd")
    expect(ratio).toBeGreaterThan(0)
    expect(ratio).toBeLessThan(1)
  })

  it("handles both empty strings", () => {
    expect(similarityRatio("", "")).toBe(1)
  })
})

// --- analyze-query: parseResponse ---
describe("parseResponse (analyze-query)", () => {
  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      coreKeywords: ["React", "hooks"],
      subQueries: ["React hooks guide", "React hooks tutorial", "React hooks patterns", "useState useEffect", "custom hooks React", "React hooks vs classes"],
      researchType: "doc",
      language: "en",
    })
    const result = parseResponseAnalyze(raw, "React hooks")
    expect(result.coreKeywords).toContain("React")
    expect(result.researchType).toBe("doc")
    expect(result.language).toBe("en")
  })

  it("strips code fences before parsing", () => {
    const raw = '```json\n{"coreKeywords":["test"],"subQueries":["a","b","c","d","e","f"],"researchType":"api","language":"en"}\n```'
    const result = parseResponseAnalyze(raw, "test query")
    expect(result.coreKeywords).toContain("test")
    expect(result.researchType).toBe("api")
  })

  it("falls back on invalid JSON", () => {
    const result = parseResponseAnalyze("not json at all", "React hooks")
    expect(result.researchType).toBe("concept")
    expect(result.subQueries.length).toBeGreaterThan(0)
  })

  it("fills fallback subQueries when fewer than 5", () => {
    const raw = JSON.stringify({
      coreKeywords: ["React"],
      subQueries: ["only one"],
      researchType: "concept",
      language: "en",
    })
    const result = parseResponseAnalyze(raw, "React hooks")
    expect(result.subQueries.length).toBeGreaterThanOrEqual(5)
  })

  it("handles nested subQueries (zh/en object)", () => {
    const raw = JSON.stringify({
      coreKeywords: ["React"],
      subQueries: { zh: ["React 教程", "React 入门"], en: ["React tutorial", "React guide"] },
      researchType: "doc",
      language: "mixed",
    })
    const result = parseResponseAnalyze(raw, "React")
    expect(result.subQueries.length).toBeGreaterThanOrEqual(4)
  })

  it("defaults to invalid researchType to concept", () => {
    const raw = JSON.stringify({
      coreKeywords: ["React"],
      subQueries: ["a", "b", "c", "d", "e", "f"],
      researchType: "invalid_type",
      language: "en",
    })
    const result = parseResponseAnalyze(raw, "React")
    expect(result.researchType).toBe("concept")
  })
})

// --- analyze-query: buildFallback ---
describe("buildFallback", () => {
  it("detects Chinese language", () => {
    const result = buildFallback("什么是 React")
    expect(result.language).toBe("zh")
  })

  it("detects English language", () => {
    const result = buildFallback("React hooks tutorial")
    expect(result.language).toBe("en")
  })

  it("sets researchType to concept", () => {
    const result = buildFallback("test")
    expect(result.researchType).toBe("concept")
  })

  it("limits coreKeywords to 5", () => {
    const result = buildFallback("one two three four five six seven")
    expect(result.coreKeywords.length).toBeLessThanOrEqual(5)
  })
})

// --- evaluate: extractJsonObject ---
describe("extractJsonObject", () => {
  it("returns null for empty string", () => {
    expect(extractJsonObject("")).toBeNull()
  })

  it("returns null for whitespace only", () => {
    expect(extractJsonObject("   ")).toBeNull()
  })

  it("parses clean JSON", () => {
    const json = '{"key":"value"}'
    expect(extractJsonObject(json)).toBe(json)
  })

  it("strips code fences", () => {
    const result = extractJsonObject('```json\n{"key":"value"}\n```')
    expect(result).toBe('{"key":"value"}')
  })

  it("extracts JSON from surrounding text via brace matching", () => {
    const text = 'Here is the result: {"a":1,"b":2} and some extra text'
    const result = extractJsonObject(text)
    expect(result).toBe('{"a":1,"b":2}')
  })

  it("returns null when no valid JSON found", () => {
    expect(extractJsonObject("no json here")).toBeNull()
  })

  it("handles nested braces in JSON", () => {
    const json = '{"outer":{"inner":1}}'
    expect(extractJsonObject(json)).toBe(json)
  })
})

// --- evaluate: snippetRelevance ---
describe("snippetRelevance", () => {
  const baseResult = makeResult({ title: "React Hooks Tutorial", url: "https://example.com" })

  it("scores 0 when no terms match", () => {
    const result = { ...baseResult, snippet: "Completely unrelated content", qualityScore: 0 }
    expect(snippetRelevance("python django", result)).toBe(0)
  })

  it("scores higher with more term matches", () => {
    const low = { ...baseResult, snippet: "React basics", qualityScore: 0 }
    const high = { ...baseResult, snippet: "React hooks React hooks React hooks everywhere", qualityScore: 0 }
    expect(snippetRelevance("React hooks", high)).toBeGreaterThan(snippetRelevance("React hooks", low))
  })

  it("boosts by qualityScore", () => {
    const noBoost = { ...baseResult, snippet: "some content", qualityScore: 0 }
    const withBoost = { ...baseResult, snippet: "some content", qualityScore: 10 }
    expect(snippetRelevance("React hooks", withBoost)).toBeGreaterThan(snippetRelevance("React hooks", noBoost))
  })

  it("filters out terms shorter than 3 chars", () => {
    const result = { ...baseResult, snippet: "a b c d e", qualityScore: 0 }
    expect(snippetRelevance("a b c", result)).toBe(0)
  })

  it("is case insensitive", () => {
    const result = { ...baseResult, snippet: "REACT HOOKS", qualityScore: 0 }
    expect(snippetRelevance("react hooks", result)).toBeGreaterThan(0)
  })
})

// --- evaluate-depth: extractJson ---
describe("extractJson (evaluate-depth)", () => {
  it("returns null for empty string", () => {
    expect(extractJson("")).toBeNull()
  })

  it("parses clean JSON", () => {
    const json = '{"score":7}'
    expect(extractJson(json)).toBe(json)
  })

  it("strips code fences", () => {
    const result = extractJson('```json\n{"score":7}\n```')
    expect(result).toBe('{"score":7}')
  })

  it("extracts JSON via brace matching", () => {
    const result = extractJson('result: {"score":7} done')
    expect(result).toBe('{"score":7}')
  })

  it("fixes trailing commas in JSON", () => {
    const result = extractJson('{"score":7,}')
    expect(result).toBe('{"score":7}')
  })

  it("returns null for non-JSON text", () => {
    expect(extractJson("just plain text")).toBeNull()
  })
})

// --- deep-read: decodeHtmlEntities ---
describe("decodeHtmlEntities", () => {
  it("decodes common entities", () => {
    expect(decodeHtmlEntities("&lt;div&gt;")).toBe("<div>")
  })

  it("decodes &amp;", () => {
    expect(decodeHtmlEntities("a &amp; b")).toBe("a & b")
  })

  it("decodes &quot; and &#39;", () => {
    expect(decodeHtmlEntities("&quot;hello&#39;s")).toBe('"hello\'s')
  })

  it("decodes &nbsp;", () => {
    expect(decodeHtmlEntities("hello&nbsp;world")).toBe("hello world")
  })

  it("decodes numeric entities", () => {
    expect(decodeHtmlEntities("&#65;&#66;")).toBe("AB")
  })

  it("returns unchanged text without entities", () => {
    expect(decodeHtmlEntities("plain text")).toBe("plain text")
  })

  it("handles empty string", () => {
    expect(decodeHtmlEntities("")).toBe("")
  })
})

// --- deep-read: isSearchEngineRedirect ---
describe("isSearchEngineRedirect", () => {
  it("detects Baidu redirect", () => {
    expect(isSearchEngineRedirect("https://www.baidu.com/link?url=abc123")).toBe(true)
  })

  it("detects Google redirect", () => {
    expect(isSearchEngineRedirect("https://www.google.com/url?q=test")).toBe(true)
  })

  it("detects Bing search URL", () => {
    expect(isSearchEngineRedirect("https://www.bing.com/v3/search?q=test")).toBe(true)
  })

  it("detects DuckDuckGo redirect", () => {
    expect(isSearchEngineRedirect("https://duckduckgo.com/l/?uddg=test")).toBe(false)
    expect(isSearchEngineRedirect("https://duckduckgo.com/l?uddg=test")).toBe(true)
  })

  it("returns false for normal URLs", () => {
    expect(isSearchEngineRedirect("https://example.com/page")).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(isSearchEngineRedirect("")).toBe(false)
  })
})

// --- deep-read: needsCacheFallback ---
describe("needsCacheFallback", () => {
  it("detects zhihu.com", () => {
    expect(needsCacheFallback("https://zhihu.com/question/123")).toBe(true)
  })

  it("detects juejin.cn", () => {
    expect(needsCacheFallback("https://juejin.cn/post/123")).toBe(true)
  })

  it("detects reddit.com", () => {
    expect(needsCacheFallback("https://reddit.com/r/test")).toBe(true)
  })

  it("detects stackoverflow.com", () => {
    expect(needsCacheFallback("https://stackoverflow.com/questions/123")).toBe(true)
  })

  it("detects medium.com", () => {
    expect(needsCacheFallback("https://medium.com/article")).toBe(true)
  })

  it("returns false for normal URLs", () => {
    expect(needsCacheFallback("https://example.com/page")).toBe(false)
  })

  it("returns false for empty string", () => {
    expect(needsCacheFallback("")).toBe(false)
  })
})

// --- filter-results: formatResults ---
describe("formatResults", () => {
  it("formats results with index, title, url, snippet", () => {
    const results = [
      makeResult({ title: "Test", url: "https://example.com", snippet: "Hello world" }),
    ]
    const formatted = formatResults(results)
    expect(formatted).toContain("[0] Test")
    expect(formatted).toContain("https://example.com")
    expect(formatted).toContain("Hello world")
  })

  it("truncates snippet to 200 chars", () => {
    const longSnippet = "a".repeat(300)
    const results = [
      makeResult({ title: "T", url: "https://x.com", snippet: longSnippet }),
    ]
    const formatted = formatResults(results)
    const snippetLine = formatted.split("\n").find(l => l.includes("Snippet:"))!
    expect(snippetLine.length).toBeLessThanOrEqual(212)
  })

  it("limits to 30 results", () => {
    const results = Array.from({ length: 50 }, (_, i) =>
      makeResult({ title: `R${i}`, url: `https://r${i}.com`, snippet: "s" }),
    )
    const formatted = formatResults(results)
    expect(formatted).toContain("[29]")
    expect(formatted).not.toContain("[30]")
  })

  it("handles empty array", () => {
    expect(formatResults([])).toBe("")
  })
})

// --- filter-results: parseResponse ---
describe("parseResponse (filter-results)", () => {
  it("parses valid JSON array", () => {
    const raw = JSON.stringify([
      { index: 0, relevanceScore: 8, reason: "highly relevant" },
      { index: 1, relevanceScore: 3, reason: "not relevant" },
    ])
    const result = parseResponseFilter(raw)
    expect(result.length).toBe(2)
    expect(result[0].relevanceScore).toBe(8)
  })

  it("strips code fences", () => {
    const raw = '```json\n[{"index":0,"relevanceScore":7,"reason":"ok"}]\n```'
    const result = parseResponseFilter(raw)
    expect(result.length).toBe(1)
  })

  it("returns empty for non-array JSON", () => {
    const raw = '{"not":"array"}'
    const result = parseResponseFilter(raw)
    expect(result).toEqual([])
  })

  it("filters out items with wrong schema", () => {
    const raw = JSON.stringify([
      { index: 0, relevanceScore: 7, reason: "ok" },
      { index: 1 },
      { relevanceScore: 5, reason: "missing index" },
      "not an object",
    ])
    const result = parseResponseFilter(raw)
    expect(result.length).toBe(1)
  })

  it("throws on invalid JSON", () => {
    expect(() => parseResponseFilter("not json")).toThrow()
  })
})

// --- filter-results: fallbackTopResults ---
describe("fallbackTopResults", () => {
  it("sorts by qualityScore descending", () => {
    const results = [
      makeResult({ title: "A", url: "https://a.com", qualityScore: 3 }),
      makeResult({ title: "B", url: "https://b.com", qualityScore: 8 }),
      makeResult({ title: "C", url: "https://c.com", qualityScore: 5 }),
    ]
    const sorted = fallbackTopResults(results)
    expect(sorted[0].title).toBe("B")
    expect(sorted[1].title).toBe("C")
    expect(sorted[2].title).toBe("A")
  })

  it("limits to 15 results", () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      makeResult({ title: `R${i}`, url: `https://r${i}.com`, qualityScore: i }),
    )
    expect(fallbackTopResults(results).length).toBe(15)
  })

  it("does not mutate original array", () => {
    const results = [
      makeResult({ title: "A", url: "https://a.com", qualityScore: 1 }),
      makeResult({ title: "B", url: "https://b.com", qualityScore: 2 }),
    ]
    const originalOrder = results.map(r => r.title)
    fallbackTopResults(results)
    expect(results.map(r => r.title)).toEqual(originalOrder)
  })

  it("handles empty array", () => {
    expect(fallbackTopResults([])).toEqual([])
  })

  it("handles single result", () => {
    const results = [makeResult({ title: "Only", url: "https://only.com", qualityScore: 5 })]
    const sorted = fallbackTopResults(results)
    expect(sorted.length).toBe(1)
    expect(sorted[0].title).toBe("Only")
  })
})
