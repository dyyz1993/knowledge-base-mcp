import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test"
import {
  buildWebSearchSuggestion,
  multiSearch,
  buildMissResponse,
  buildSearchPipelineSources,
} from "../src/search/kb-ask-pipeline"
import type { DocMeta } from "../src/storage/index"
import { McpWebSearch } from "../src/search/mcp-web-search"

function makeDoc(overrides: Partial<DocMeta & { score: number; snippet?: string; matched_by?: string[] }> = {}): DocMeta & { score: number; snippet?: string; matched_by: string[] } {
  return {
    id: "doc-" + Math.random().toString(36).slice(2, 8),
    title: "Test Doc",
    tags: ["test"],
    keywords: ["test"],
    intent: "Testing",
    project_description: "Test project",
    source_project: "",
    source_worktree: "",
    related_projects: [],
    related_files: [],
    created_at: Date.now(),
    file_path: "/tmp/test.md",
    score: 50,
    matched_by: [],
    ...overrides,
  }
}

describe("buildWebSearchSuggestion", () => {
  it("maps fields correctly", () => {
    const result = buildWebSearchSuggestion("need more info", "how to use opencode", ["api", "cli"])
    expect(result).toEqual({
      reason: "need more info",
      search_query: "how to use opencode",
      missing_aspects: ["api", "cli"],
    })
  })

  it("handles empty missing_aspects", () => {
    const result = buildWebSearchSuggestion("fallback", "query", [])
    expect(result!.missing_aspects).toEqual([])
    expect(result!.search_query).toBe("query")
  })

  it("returns object with correct keys", () => {
    const result = buildWebSearchSuggestion("r", "q", ["a"])
    expect(Object.keys(result!)).toEqual(["reason", "search_query", "missing_aspects"])
  })
})

describe("multiSearch", () => {
  let searchDocsCombinedMock: ReturnType<typeof mock>

  beforeEach(() => {
    searchDocsCombinedMock = mock(() => Promise.resolve([]))
    mock.module("../src/storage/index", () => ({
      searchDocs: mock(() => []),
      searchDocsCombined: searchDocsCombinedMock,
      readDoc: mock(() => null),
      writeDoc: mock(() => ({ id: "x" })),
      resolveMiss: mock(() => {}),
      recordMiss: mock(() => ({ total_misses: 1, recurring: false })),
    }))
  })

  afterEach(() => {
    mock.restore()
  })

  it("returns empty when searchDocs returns nothing", async () => {
    const result = await multiSearch(["query1", "query2"])
    expect(result).toEqual([])
  })

  it("deduplicates by id and applies RRF fusion", async () => {
    const doc1 = makeDoc({ id: "a", title: "Doc A", score: 30 })
    const doc2 = makeDoc({ id: "b", title: "Doc B", score: 20 })

    searchDocsCombinedMock.mockImplementation((q: string) => {
      if (q === "q1") return Promise.resolve([doc1, doc2])
      if (q === "q2") return Promise.resolve([makeDoc({ ...doc1, score: 15 })])
      return Promise.resolve([])
    })

    const result = await multiSearch(["q1", "q2"])
    const docA = result.find(r => r.id === "a")
    expect(docA).toBeDefined()
    // RRF: doc-a appears at rank 0 in q1 (1/61) and rank 0 in q2 (1/61) = 2/61
    expect(docA!.score).toBeCloseTo(2 / 61, 10)
    expect(result.find(r => r.id === "b")).toBeDefined()
  })

  it("sorts results by RRF score descending", async () => {
    const low = makeDoc({ id: "low", title: "Low", score: 10 })
    const high = makeDoc({ id: "high", title: "High", score: 80 })
    const mid = makeDoc({ id: "mid", title: "Mid", score: 40 })

    searchDocsCombinedMock.mockReturnValueOnce(Promise.resolve([high, mid, low]))

    const result = await multiSearch(["single-query"])
    // RRF: rank 0 = high (1/61), rank 1 = mid (1/62), rank 2 = low (1/63)
    expect(result[0]!.id).toBe("high")
    expect(result[1]!.id).toBe("mid")
    expect(result[2]!.id).toBe("low")
  })

  it("respects limit parameter for each query", async () => {
    const docs = Array.from({ length: 10 }, (_, i) => makeDoc({ id: `doc${i}`, score: i }))
    searchDocsCombinedMock.mockReturnValueOnce(Promise.resolve(docs.slice(0, 3)))

    const result = await multiSearch(["q"], 3)
    expect(result).toHaveLength(3)
  })
})

describe("buildMissResponse", () => {
  let recordMissMock: ReturnType<typeof mock>

  beforeEach(() => {
    recordMissMock = mock(() => ({ total_misses: 1, recurring: false }))
    mock.module("../src/storage/index", () => ({
      searchDocs: mock(() => []),
      readDoc: mock(() => null),
      writeDoc: mock(() => ({ id: "x" })),
      resolveMiss: mock(() => {}),
      recordMiss: recordMissMock,
    }))
  })

  afterEach(() => {
    mock.restore()
  })

  it("returns miss response with correct structure", () => {
    const result = buildMissResponse("test query", ["q1", "q2"], 2)

    expect(result.from_kb).toBe(false)
    expect(result.miss).toBe(true)
    expect(result.loops_used).toBe(2)
    expect(result.queries_used).toEqual(["q1", "q2"])
  })

  it("includes miss_stats from recordMiss", () => {
    recordMissMock.mockReturnValue({ total_misses: 5, recurring: true })

    const result = buildMissResponse("q", ["q"], 1)

    expect(result.miss_stats).toEqual({ total_unresolved: 5, recurring: true })
  })

  it("includes suggested_workflow with last query", () => {
    const result = buildMissResponse("q", ["first", "second", "last"], 2)

    expect(result.suggested_workflow!.step_1_search).toContain("last")
    expect(result.suggested_workflow!.step_2_read).toBeDefined()
    expect(result.suggested_workflow!.step_3_store).toBeDefined()
  })

  it("includes alternative_workflows", () => {
    const result = buildMissResponse("q", ["q"], 1)

    expect(result.alternative_workflows).toBeDefined()
    expect(Object.keys(result.alternative_workflows!)).toEqual(["github_repo", "js_rendered_page", "local_project"])
  })

  it("hint mentions recurring when recurring is true", () => {
    recordMissMock.mockReturnValue({ total_misses: 3, recurring: true })

    const result = buildMissResponse("q", ["q"], 2)
    expect(result.hint).toContain("3")
    expect(result.hint).toContain("miss")
  })

  it("hint mentions loop count when not recurring", () => {
    recordMissMock.mockReturnValue({ total_misses: 1, recurring: false })

    const result = buildMissResponse("q", ["q"], 3)
    expect(result.hint).toContain("3")
  })

  it("uses original query when queries_used is empty", () => {
    const result = buildMissResponse("original", [], 0)
    expect(result.suggested_workflow!.step_1_search).toContain("original")
  })
})

describe("buildSearchPipelineSources", () => {
  it("returns empty array when no sources configured", () => {
    const sources = buildSearchPipelineSources({
      webSearch: { apiKey: "", enabled: true, tavilyApiKey: "", serperApiKey: "" },
      searchPipeline: {
        enabled: true,
        sources: {
          webSearchPrime: { enabled: false },
          xbrowser: { enabled: false, engine: "google", engines: [], cdpEndpoint: "", headless: true, timeout: 30000 },
          llmDirect: { enabled: false, baseUrl: "", apiKey: "", model: "" },
          plugin: { enabled: false, prompt: "" },
          tavily: { enabled: false },
          serper: { enabled: false },
          aiSearch: { enabled: false, engines: [], timeout: 60000 },
        },
        maxResults: 10,
      },
    } as any)
    expect(sources).toEqual([])
  })

  it("includes webSearchPrime when enabled with apiKey", () => {
    const sources = buildSearchPipelineSources({
      webSearch: { apiKey: "test-key", enabled: true, tavilyApiKey: "", serperApiKey: "" },
      searchPipeline: {
        enabled: true,
        sources: {
          webSearchPrime: { enabled: true },
          xbrowser: { enabled: false, engine: "google", engines: [], cdpEndpoint: "", headless: true, timeout: 30000 },
          llmDirect: { enabled: false, baseUrl: "", apiKey: "", model: "" },
          plugin: { enabled: false, prompt: "" },
          tavily: { enabled: false },
          serper: { enabled: false },
          aiSearch: { enabled: false, engines: [], timeout: 60000 },
        },
        maxResults: 10,
      },
    } as any)
    expect(sources.length).toBeGreaterThan(0)
    expect(sources[0]!.name).toBe("web-search-prime")
  })

  it("excludes webSearchPrime when enabled but no apiKey", () => {
    const sources = buildSearchPipelineSources({
      webSearch: { apiKey: "", enabled: true, tavilyApiKey: "", serperApiKey: "" },
      searchPipeline: {
        enabled: true,
        sources: {
          webSearchPrime: { enabled: true },
          xbrowser: { enabled: false, engine: "google", engines: [], cdpEndpoint: "", headless: true, timeout: 30000 },
          llmDirect: { enabled: false, baseUrl: "", apiKey: "", model: "" },
          plugin: { enabled: false, prompt: "" },
          tavily: { enabled: false },
          serper: { enabled: false },
          aiSearch: { enabled: false, engines: [], timeout: 60000 },
        },
        maxResults: 10,
      },
    } as any)
    const names = sources.map(s => s.name)
    expect(names).not.toContain("web-search-prime")
  })

  it("includes tavily when enabled with apiKey", () => {
    const sources = buildSearchPipelineSources({
      webSearch: { apiKey: "", enabled: true, tavilyApiKey: "tav-key", serperApiKey: "" },
      searchPipeline: {
        enabled: true,
        sources: {
          webSearchPrime: { enabled: false },
          xbrowser: { enabled: false, engine: "google", engines: [], cdpEndpoint: "", headless: true, timeout: 30000 },
          llmDirect: { enabled: false, baseUrl: "", apiKey: "", model: "" },
          plugin: { enabled: false, prompt: "" },
          tavily: { enabled: true },
          serper: { enabled: false },
          aiSearch: { enabled: false, engines: [], timeout: 60000 },
        },
        maxResults: 10,
      },
    } as any)
    const names = sources.map(s => s.name)
    expect(names).toContain("tavily")
  })

  it("includes serper when enabled with apiKey", () => {
    const sources = buildSearchPipelineSources({
      webSearch: { apiKey: "", enabled: true, tavilyApiKey: "", serperApiKey: "serper-key" },
      searchPipeline: {
        enabled: true,
        sources: {
          webSearchPrime: { enabled: false },
          xbrowser: { enabled: false, engine: "google", engines: [], cdpEndpoint: "", headless: true, timeout: 30000 },
          llmDirect: { enabled: false, baseUrl: "", apiKey: "", model: "" },
          plugin: { enabled: false, prompt: "" },
          tavily: { enabled: false },
          serper: { enabled: true },
          aiSearch: { enabled: false, engines: [], timeout: 60000 },
        },
        maxResults: 10,
      },
    } as any)
    const names = sources.map(s => s.name)
    expect(names).toContain("serper")
  })

  it("returns empty when searchPipeline is undefined", () => {
    const sources = buildSearchPipelineSources({
      webSearch: { apiKey: "", enabled: true, tavilyApiKey: "", serperApiKey: "" },
    } as any)
    expect(sources).toEqual([])
  })
})

describe("McpWebSearch classifyError (indirect)", () => {
  it("searchAvailable is true initially", () => {
    const mcp = new McpWebSearch("fake-key")
    expect(mcp.searchAvailable).toBe(true)
    expect(mcp.readerAvailable).toBe(true)
    expect(mcp.disabledReason).toBe("")
  })

  it("search returns empty when disabled by quota", async () => {
    const mcp = new McpWebSearch("fake-key")

    ;(mcp as unknown as { _searchDisabled: boolean })._searchDisabled = true
    ;(mcp as unknown as { _disabledReason: string })._disabledReason = "429 rate limited"
    ;(mcp as unknown as { _disabledAt: number })._disabledAt = Date.now()

    expect(mcp.searchAvailable).toBe(false)
    const results = await mcp.search("test")
    expect(results).toEqual([])
  })

  it("readUrl returns null when disabled by quota", async () => {
    const mcp = new McpWebSearch("fake-key")

    ;(mcp as unknown as { _readerDisabled: boolean })._readerDisabled = true
    ;(mcp as unknown as { _disabledReason: string })._disabledReason = "quota exceeded"

    expect(mcp.readerAvailable).toBe(false)
    const result = await mcp.readUrl("https://example.com")
    expect(result).toBeNull()
  })

  it("detects 429 as quota error and disables search", async () => {
    const mcp = new McpWebSearch("fake-key")

    const clientMock = {
      callTool: mock(() => { throw new Error("HTTP 429: Too Many Requests") }),
    }
    ;(mcp as unknown as { getSearchClient: () => Promise<unknown> }).getSearchClient = mock(async () => clientMock)

    const results = await mcp.search("test")
    expect(results).toEqual([])
    expect(mcp.searchAvailable).toBe(false)
    expect(mcp.disabledReason).toContain("429")
  })

  it("detects rate limit message as quota error", async () => {
    const mcp = new McpWebSearch("fake-key")

    const clientMock = {
      callTool: mock(() => { throw new Error("rate_limit exceeded for this API key") }),
    }
    ;(mcp as unknown as { getSearchClient: () => Promise<unknown> }).getSearchClient = mock(async () => clientMock)

    const results = await mcp.search("test")
    expect(results).toEqual([])
    expect(mcp.searchAvailable).toBe(false)
  })

  it("detects quota exceeded for reader", async () => {
    const mcp = new McpWebSearch("fake-key")

    const clientMock = {
      callTool: mock(() => { throw new Error("Quota exceeded for web reader") }),
    }
    ;(mcp as unknown as { getReaderClient: () => Promise<unknown> }).getReaderClient = mock(async () => clientMock)

    const result = await mcp.readUrl("https://example.com")
    expect(result).toBeNull()
    expect(mcp.readerAvailable).toBe(false)
  })

  it("non-quota non-retryable errors do not disable search", async () => {
    const mcp = new McpWebSearch("fake-key")

    const clientMock = {
      callTool: mock(() => { throw new Error("Some unknown error") }),
    }
    ;(mcp as unknown as { getSearchClient: () => Promise<unknown> }).getSearchClient = mock(async () => clientMock)

    const results = await mcp.search("test")
    expect(results).toEqual([])
    expect(mcp.searchAvailable).toBe(true)
  })

  it("retryable errors retry up to maxRetries", async () => {
    const mcp = new McpWebSearch("fake-key")

    const clientMock = {
      callTool: mock(() => { throw new Error("502 Bad Gateway") }),
    }
    ;(mcp as unknown as { getSearchClient: () => Promise<unknown> }).getSearchClient = mock(async () => clientMock)

    const results = await mcp.search("test")
    expect(results).toEqual([])
    expect(mcp.searchAvailable).toBe(true)
    expect(clientMock.callTool).toHaveBeenCalledTimes(3)
  })
})
