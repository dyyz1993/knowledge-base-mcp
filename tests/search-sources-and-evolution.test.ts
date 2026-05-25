import { describe, it, expect, mock, beforeAll, beforeEach, afterEach, afterAll, spyOn } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"

const RUN_ISOLATED = !process.env.KB_FULL_SUITE

let _execFileResponse: any = { stdout: JSON.stringify({ results: [] }) }
let _execFileError: Error | null = null

const configState: Record<string, any> = {
  tavilyApiKey: "test-tavily-key",
  serperApiKey: "test-serper-key",
}

let _aiSearchResult: any = {
  results: [
    { title: "AI Result", url: "https://ai.com/1", snippet: "AI snippet", aiSummary: "AI summary" },
  ],
}

let _fuzzyIndex: Record<string, any> | null = {
  documents: {
    doc1: { title: "React Hooks Complete Guide", keywords: ["react", "hooks", "useEffect", "useState"], tags: ["tutorial", "reference"], intent: "Learn React hooks patterns", project_description: "React frontend project" },
    doc2: { title: "TypeScript Best Practices", keywords: ["typescript", "types", "generics"], tags: ["best-practice"], intent: "Write better TypeScript", project_description: "Node.js backend" },
    doc3: { title: "Docker Deployment Guide", keywords: ["docker", "containers", "deployment"], tags: ["guide", "devops"], intent: "Deploy apps with Docker", project_description: "DevOps infrastructure" },
  },
}

const _testTempDir = join(os.tmpdir(), `kb-search-test-${process.pid}-${Date.now()}`)
const _testDataDir = join(_testTempDir, ".kb-chat")
const _testKbDir = join(_testTempDir, ".knowledge")

function withConfig<T>(overrides: Record<string, any>, fn: () => T): T {
  const { _setLoadConfigOverride } = require("../src/config") as any
  _setLoadConfigOverride((realConfig: any) => {
    const real = realConfig()
    return {
      ...real,
      webSearch: {
        ...(real.webSearch || {}),
        tavilyApiKey: overrides.tavilyApiKey ?? real.webSearch?.tavilyApiKey,
        serperApiKey: overrides.serperApiKey ?? real.webSearch?.serperApiKey,
      },
      searchPipeline: {
        ...(real.searchPipeline || {}),
        sources: {
          ...(real.searchPipeline?.sources || {}),
          aiSearch: {
            ...(real.searchPipeline?.sources?.aiSearch || {}),
            enabled: overrides.aiSearchEnabled ?? real.searchPipeline?.sources?.aiSearch?.enabled,
            engines: overrides.aiSearchEngines ?? real.searchPipeline?.sources?.aiSearch?.engines,
          },
          xbrowser: {
            ...(real.searchPipeline?.sources?.xbrowser || {}),
            cdpEndpoint: overrides.xbrowserCdp ?? real.searchPipeline?.sources?.xbrowser?.cdpEndpoint,
          },
        },
      },
    }
  })
  try {
    return fn()
  } finally {
    _setLoadConfigOverride(null)
  }
}

async function withConfigAsync<T>(overrides: Record<string, any>, fn: () => Promise<T>): Promise<T> {
  const { _setLoadConfigOverride } = require("../src/config") as any
  _setLoadConfigOverride((realConfig: any) => {
    const real = realConfig()
    return {
      ...real,
      webSearch: {
        ...(real.webSearch || {}),
        tavilyApiKey: overrides.tavilyApiKey ?? real.webSearch?.tavilyApiKey,
        serperApiKey: overrides.serperApiKey ?? real.webSearch?.serperApiKey,
      },
      searchPipeline: {
        ...(real.searchPipeline || {}),
        sources: {
          ...(real.searchPipeline?.sources || {}),
          aiSearch: {
            ...(real.searchPipeline?.sources?.aiSearch || {}),
            enabled: overrides.aiSearchEnabled ?? real.searchPipeline?.sources?.aiSearch?.enabled,
            engines: overrides.aiSearchEngines ?? real.searchPipeline?.sources?.aiSearch?.engines,
          },
          xbrowser: {
            ...(real.searchPipeline?.sources?.xbrowser || {}),
            cdpEndpoint: overrides.xbrowserCdp ?? real.searchPipeline?.sources?.xbrowser?.cdpEndpoint,
          },
        },
      },
    }
  })
  try {
    return await fn()
  } finally {
    _setLoadConfigOverride(null)
  }
}

if (RUN_ISOLATED) {
  mock.module("node:child_process", () => ({
    execFile: (_cmd: string, _args: string[], _opts: any, cb: Function) => {
      if (_execFileError) cb(_execFileError, null)
      else cb(null, _execFileResponse)
    },
    execSync: (..._args: any[]) => Buffer.from(""),
    exec: (..._args: any[]) => {},
    spawn: (..._args: any[]) => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } }),
    fork: (..._args: any[]) => ({ on: () => {} }),
  }))

  mock.module("node:util", () => {
    const util = import.meta.require("node:util")
    return {
      ...util,
      promisify: (fn: Function) => {
        return (...args: any[]) =>
          new Promise((resolve, reject) => {
            fn(...args, (err: any, result: any) => {
              if (err) reject(err)
              else resolve(result)
            })
          })
      },
    }
  })

  mock.module("../src/search/xbrowser-cli", () => {
    class MockXBrowserCLI {
      aiSearch() { return Promise.resolve(_aiSearchResult) }
      search() {
        return Promise.resolve([
          { title: "XB test Result", url: "https://xb.com/1", snippet: "xb test snippet" },
          { title: "XB test Result 2", url: "https://xb.com/2", snippet: "xb test snippet 2" },
        ])
      }
    }
    return { XBrowserCLI: MockXBrowserCLI }
  })

  mock.module("../src/search/utils", () => ({
    normalizeUrl: (url: string) => url.replace(/\/+$/, "").toLowerCase(),
  }))
}

const describeSuite = RUN_ISOLATED ? describe : describe.skip

afterAll(() => {
  try { rmSync(_testTempDir, { recursive: true, force: true }) } catch {}
})

// ─── source-tavily ────────────────────────────────────────────
describeSuite("source-tavily", () => {
  let TavilySource: any

  beforeAll(async () => {
    const mod = await import("../src/search/source-tavily")
    TavilySource = mod.TavilySource
  })

  beforeEach(() => {
    _execFileError = null
    _execFileResponse = { stdout: JSON.stringify({ results: [] }) }
  })

  it("should be available when API key is set", () => {
    withConfig({ tavilyApiKey: "test-tavily-key" }, () => {
      const src = new TavilySource()
      expect(src.available()).toBe(true)
    })
  })

  it("should not be available when API key is missing", () => {
    withConfig({ tavilyApiKey: "" }, () => {
      const src = new TavilySource()
      expect(src.available()).toBe(false)
    })
  })

  it("should parse search results correctly", async () => {
    _execFileResponse = {
      stdout: JSON.stringify({
        results: [
          { title: "Test Title", url: "https://example.com", content: "Some content here" },
          { title: "Another", url: "https://foo.com", content: "More content" },
        ],
      }),
    }
    const { _setLoadConfigOverride } = require("../src/config") as any
    _setLoadConfigOverride((realConfig: any) => {
      const real = realConfig()
      return {
        ...real,
        webSearch: { ...(real.webSearch || {}), tavilyApiKey: "test-tavily-key" },
        searchPipeline: real.searchPipeline,
      }
    })
    try {
      const src = new TavilySource()
      const results = await src.search("test query")
      expect(results.length).toBe(2)
      expect(results[0].title).toBe("Test Title")
      expect(results[0].url).toBe("https://example.com")
      expect(results[0].snippet).toBe("Some content here")
      expect(results[0].source).toBe("tavily")
      expect(results[0].qualityScore).toBe(5)
    } finally {
      _setLoadConfigOverride(null)
    }
  })

  it("should return empty on API errors", async () => {
    _execFileError = new Error("network error")
    await withConfigAsync({ tavilyApiKey: "test-tavily-key" }, async () => {
      const src = new TavilySource()
      const results = await src.search("fail query")
      expect(results).toEqual([])
    })
  })

  it("should return empty when results array is missing", async () => {
    _execFileResponse = { stdout: JSON.stringify({ message: "no results" }) }
    await withConfigAsync({ tavilyApiKey: "test-tavily-key" }, async () => {
      const src = new TavilySource()
      const results = await src.search("empty")
      expect(results).toEqual([])
    })
  })

  it("should truncate snippet to 300 chars", async () => {
    _execFileResponse = {
      stdout: JSON.stringify({
        results: [{ title: "T", url: "https://x.com", content: "a".repeat(500) }],
      }),
    }
    const { _setLoadConfigOverride } = require("../src/config") as any
    _setLoadConfigOverride((realConfig: any) => {
      const real = realConfig()
      return { ...real, webSearch: { ...(real.webSearch || {}), tavilyApiKey: "test-tavily-key" }, searchPipeline: real.searchPipeline }
    })
    try {
      const src = new TavilySource()
      const results = await src.search("long")
      expect(results[0].snippet.length).toBeLessThanOrEqual(300)
    } finally {
      _setLoadConfigOverride(null)
    }
  })
})

// ─── source-serper ────────────────────────────────────────────
describeSuite("source-serper", () => {
  let SerperSource: any

  beforeAll(async () => {
    const mod = await import("../src/search/source-serper")
    SerperSource = mod.SerperSource
  })

  beforeEach(() => {
    _execFileError = null
    _execFileResponse = { stdout: JSON.stringify({ organic: [] }) }
  })

  it("should be available when API key is set", () => {
    withConfig({ serperApiKey: "test-serper-key" }, () => {
      const src = new SerperSource()
      expect(src.available()).toBe(true)
    })
  })

  it("should not be available when API key is missing", () => {
    withConfig({ serperApiKey: "" }, () => {
      const src = new SerperSource()
      expect(src.available()).toBe(false)
    })
  })

  it("should parse Google search results from organic field", async () => {
    _execFileResponse = {
      stdout: JSON.stringify({
        organic: [
          { title: "Google Result", link: "https://google.com/r1", snippet: "Snippet 1" },
          { title: "Google Result 2", link: "https://google.com/r2", snippet: "Snippet 2" },
        ],
      }),
    }
    const { _setLoadConfigOverride } = require("../src/config") as any
    _setLoadConfigOverride((realConfig: any) => {
      const real = realConfig()
      return { ...real, webSearch: { ...(real.webSearch || {}), serperApiKey: "test-serper-key" }, searchPipeline: real.searchPipeline }
    })
    try {
      const src = new SerperSource()
      const results = await src.search("google query")
      expect(results.length).toBe(2)
      expect(results[0].title).toBe("Google Result")
      expect(results[0].url).toBe("https://google.com/r1")
      expect(results[0].source).toBe("serper")
    } finally {
      _setLoadConfigOverride(null)
    }
  })

  it("should handle API errors gracefully", async () => {
    _execFileError = new Error("serper down")
    await withConfigAsync({ serperApiKey: "test-serper-key" }, async () => {
      const src = new SerperSource()
      const results = await src.search("fail")
      expect(results).toEqual([])
    })
  })

  it("should return empty when organic field is absent", async () => {
    _execFileResponse = { stdout: JSON.stringify({ knowledgeGraph: {} }) }
    await withConfigAsync({ serperApiKey: "test-serper-key" }, async () => {
      const src = new SerperSource()
      const results = await src.search("no organic")
      expect(results).toEqual([])
    })
  })
})

// ─── source-ai-search ─────────────────────────────────────────
describeSuite("source-ai-search", () => {
  let AiSearchSource: any

  beforeAll(async () => {
    const mod = await import("../src/search/source-ai-search")
    AiSearchSource = mod.AiSearchSource
  })

  beforeEach(() => {
    _aiSearchResult = {
      results: [
        { title: "AI Result", url: "https://ai.com/1", snippet: "AI snippet", aiSummary: "AI summary" },
      ],
    }
  })

  it("should be available when enabled with engines and cdpEndpoint", () => {
    withConfig({ aiSearchEnabled: true, aiSearchEngines: ["deepseek"], xbrowserCdp: "ws://localhost:9222" }, () => {
      const src = new AiSearchSource()
      expect(src.available()).toBe(true)
    })
  })

  it("should not be available when disabled", () => {
    withConfig({ aiSearchEnabled: false, aiSearchEngines: [], xbrowserCdp: "" }, () => {
      const src = new AiSearchSource()
      expect(src.available()).toBe(false)
    })
  })

  it("should not be available without cdpEndpoint", () => {
    withConfig({ xbrowserCdp: "" }, () => {
      const src = new AiSearchSource()
      expect(src.available()).toBe(false)
    })
  })

  it("should parse AI search results", async () => {
    await withConfigAsync({ aiSearchEnabled: true, aiSearchEngines: ["deepseek"], xbrowserCdp: "ws://localhost:9222" }, async () => {
      const src = new AiSearchSource()
      const results = await src.search("ai query")
      expect(results.length).toBe(1)
      expect(results[0].source).toBe("ai-search")
      expect(results[0].qualityScore).toBe(8)
    })
  })
})

// ─── source-llm-direct ───────────────────────────────────────
describeSuite("source-llm-direct", () => {
  let LlmDirectSource: any
  let getModelsMock: any

  beforeEach(async () => {
    getModelsMock = mock(() => [
      { id: "flash-model", apiKey: "key1", baseUrl: "https://api.example.com" },
    ])

    mock.module("../src/chat/api-models", () => ({
      getConfiguredModels: getModelsMock,
      handleGetModels: async (_req: any, res: any) => { res.writeHead(200); res.end("[]") },
      handleSetModel: async (_req: any, res: any) => { res.writeHead(200); res.end("{}") },
    }))

    const mod = await import("../src/search/source-llm-direct")
    LlmDirectSource = mod.LlmDirectSource
  })

  it("should be available when models are configured", () => {
    const src = new LlmDirectSource()
    expect(src.available()).toBe(true)
  })

  it("should not be available when no models configured", () => {
    getModelsMock.mockReturnValue([])
    const src = new LlmDirectSource()
    expect(src.available()).toBe(false)
  })

  it("should prefer small/flash models", async () => {
    getModelsMock.mockReturnValue([
      { id: "big-model", apiKey: "k1", baseUrl: "https://api.big.com" },
      { id: "flash-model", apiKey: "k2", baseUrl: "https://api.small.com" },
    ])

    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        choices: [{ message: { content: "LLM answer text" } }],
      })),
    )

    const src = new LlmDirectSource()
    const results = await src.search("test")
    expect(fetchSpy).toHaveBeenCalled()
    const callUrl = (fetchSpy.mock.calls[0] as any[])[0] as string
    expect(callUrl).toContain("api.small.com")
    expect(results.length).toBe(1)
    expect(results[0].source).toBe("llm-direct")
    expect(results[0].sourceType).toBe("llm-knowledge")
    expect(results[0].snippet).toBe("LLM answer text")
    fetchSpy.mockRestore()
  })

  it("should handle fetch errors", async () => {
    spyOn(globalThis, "fetch").mockRejectedValue(new Error("timeout"))
    const src = new LlmDirectSource()
    const results = await src.search("fail")
    expect(results).toEqual([])
  })

  it("should return empty when no content in response", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ choices: [] })),
    )
    const src = new LlmDirectSource()
    const results = await src.search("empty")
    expect(results).toEqual([])
  })
})

// ─── source-xbrowser ─────────────────────────────────────────
describeSuite("source-xbrowser", () => {
  let XBrowserEngineSource: any
  let XBrowserMultiEngineSource: any
  let createXBrowserSources: any

  beforeAll(async () => {
    const mod = await import("../src/search/source-xbrowser")
    XBrowserEngineSource = mod.XBrowserEngineSource
    XBrowserMultiEngineSource = mod.XBrowserMultiEngineSource
    createXBrowserSources = mod.createXBrowserSources
  })

  it("should create engine source with correct name", () => {
    const src = new XBrowserEngineSource(
      { enabled: true, engine: "google", cdpEndpoint: "", headless: true, timeout: 10000 },
      "google",
    )
    expect(src.name).toBe("xbrowser-google")
    expect(src.available()).toBe(true)
  })

  it("should return results from search", async () => {
    const src = new XBrowserEngineSource(
      { enabled: true, engine: "bing", cdpEndpoint: "", headless: true, timeout: 10000 },
      "bing",
    )
    const results = await src.search("test query words")
    expect(results.length).toBe(2)
    expect(results[0].source).toBe("xbrowser-bing")
  })

  it("should merge multi-engine results by URL", async () => {
    const src = new XBrowserMultiEngineSource(
      { enabled: true, engine: "google", cdpEndpoint: "", headless: true, timeout: 10000 },
      ["google", "bing"] as any,
    )
    const results = await src.search("merge test query")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].source).toBe("xbrowser")
  })

  it("createXBrowserSources returns empty when disabled", () => {
    const sources = createXBrowserSources(
      { enabled: false, engine: "google", cdpEndpoint: "", headless: true, timeout: 10000 },
      [],
    )
    expect(sources).toEqual([])
  })

  it("createXBrowserSources returns multi-engine source when enabled", () => {
    const sources = createXBrowserSources(
      { enabled: true, engine: "google", cdpEndpoint: "", headless: true, timeout: 10000 },
      ["google", "bing"] as any,
    )
    expect(sources.length).toBe(1)
    expect(sources[0].name).toBe("xbrowser")
  })

  it("createXBrowserSources defaults to google when no engines specified", () => {
    const sources = createXBrowserSources(
      { enabled: true, engine: "google", cdpEndpoint: "", headless: true, timeout: 10000 },
      [],
    )
    expect(sources.length).toBe(1)
  })
})

// ─── fuzzy-search extended ────────────────────────────────────
describeSuite("fuzzy-search extended", () => {
  let fuzzySearch: any
  let invalidateFuzzyIndex: any
  let _setDeps: any
  let _resetDeps: any

  beforeAll(async () => {
    const mod = await import("../src/search/fuzzy-search")
    fuzzySearch = mod.fuzzySearch
    invalidateFuzzyIndex = mod.invalidateFuzzyIndex
    _setDeps = mod._setDeps
    _resetDeps = mod._resetDeps
  })

  beforeEach(() => {
    _fuzzyIndex = {
      documents: {
        doc1: { title: "React Hooks Complete Guide", keywords: ["react", "hooks", "useEffect", "useState"], tags: ["tutorial", "reference"], intent: "Learn React hooks patterns", project_description: "React frontend project" },
        doc2: { title: "TypeScript Best Practices", keywords: ["typescript", "types", "generics"], tags: ["best-practice"], intent: "Write better TypeScript", project_description: "Node.js backend" },
        doc3: { title: "Docker Deployment Guide", keywords: ["docker", "containers", "deployment"], tags: ["guide", "devops"], intent: "Deploy apps with Docker", project_description: "DevOps infrastructure" },
      },
    }
    _setDeps({ readIndex: () => _fuzzyIndex })
    invalidateFuzzyIndex()
  })

  afterEach(() => {
    _resetDeps()
    invalidateFuzzyIndex()
  })

  it("should find docs with slight typos", () => {
    const results = fuzzySearch("Reat Hoks", 5)
    expect(results.length).toBeGreaterThan(0)
    expect(results.some((r: any) => r.id === "doc1")).toBe(true)
  })

  it("should rank exact matches higher than fuzzy", () => {
    const results = fuzzySearch("React Hooks", 10)
    const reactIdx = results.findIndex((r: any) => r.id === "doc1")
    const tsIdx = results.findIndex((r: any) => r.id === "doc2")
    if (reactIdx !== -1 && tsIdx !== -1) {
      expect(reactIdx).toBeLessThan(tsIdx)
    }
  })

  it("should handle very long queries", () => {
    const longQuery = "React hooks ".repeat(50)
    const results = fuzzySearch(longQuery, 5)
    expect(Array.isArray(results)).toBe(true)
  })

  it("should handle queries with special characters", () => {
    const results = fuzzySearch("React + TypeScript: hooks & generics @2024!", 5)
    expect(Array.isArray(results)).toBe(true)
  })

  it("should respect limit parameter", () => {
    const results = fuzzySearch("guide", 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })

  it("should return empty for no-index scenario", () => {
    _setDeps({ readIndex: () => null })
    invalidateFuzzyIndex()
    const results = fuzzySearch("anything", 5)
    expect(results).toEqual([])
  })
})

// ─── research evolution: analyzer ─────────────────────────────
describeSuite("research evolution: analyzer", () => {
  let computeCaseMetrics: any
  let aggregateMetrics: any
  let diffMetrics: any

  beforeAll(async () => {
    const mod = await import("../src/research/evolution/analyzer")
    computeCaseMetrics = mod.computeCaseMetrics
    aggregateMetrics = mod.aggregateMetrics
    diffMetrics = mod.diffMetrics
  })

  it("should compute metrics from research result", () => {
    const result = {
      query: "React hooks",
      phaseLog: [
        "analyze quality=7 coverage=8",
        "evaluate quality=8 coverage=9",
      ],
      deepReadResults: [
        { success: true, source: "fetch" },
        { success: false, source: "xbrowser" },
        { success: true, source: "fetch" },
      ],
      summary: "This is a comprehensive guide about React hooks.\n## 参考资料\n- ref1",
    }
    const metrics = computeCaseMetrics(result, 12.5)

    expect(metrics.qualityScore).toBe(8)
    expect(metrics.coverageScore).toBe(9)
    expect(metrics.drSuccess).toBe(2)
    expect(metrics.drTotal).toBe(3)
    expect(metrics.drRate).toBeCloseTo(2 / 3)
    expect(metrics.steps).toBe(2)
    expect(metrics.loops).toBe(2)
    expect(metrics.timeSec).toBe(13)
    expect(metrics.hasSitemap).toBe(false)
    expect(metrics.hasGithub).toBe(false)
    expect(metrics.hasReferences).toBe(true)
    expect(metrics.sources.fetch).toBe(2)
    expect(metrics.sources.xbrowser).toBe(1)
  })

  it("should detect sitemap and github presence", () => {
    const result = {
      phaseLog: [
        "sitemap deep-reading done",
        "github reading completed",
        "analyze quality=6 coverage=7",
      ],
      deepReadResults: [{ success: true, source: "sitemap" }],
      summary: "Summary",
    }
    const metrics = computeCaseMetrics(result, 5)
    expect(metrics.hasSitemap).toBe(true)
    expect(metrics.hasGithub).toBe(true)
  })

  it("should handle empty result data", () => {
    const metrics = computeCaseMetrics({}, 0)
    expect(metrics.qualityScore).toBe(0)
    expect(metrics.coverageScore).toBe(0)
    expect(metrics.drTotal).toBe(0)
    expect(metrics.drRate).toBe(0)
    expect(metrics.steps).toBe(0)
    expect(metrics.loops).toBe(0)
    expect(metrics.hasReferences).toBe(false)
  })

  it("should compute aggregate metrics across cases", () => {
    const cases = [
      { id: "case-1", category: "", summaryChars: 100, qualityScore: 7, coverageScore: 8, drSuccess: 3, drTotal: 4, drRate: 0.75, steps: 5, loops: 2, timeSec: 10, hasSitemap: true, hasGithub: false, hasReferences: true, fallback: false, sources: {} },
      { id: "case-2", category: "", summaryChars: 200, qualityScore: 9, coverageScore: 9, drSuccess: 4, drTotal: 4, drRate: 1.0, steps: 6, loops: 3, timeSec: 20, hasSitemap: false, hasGithub: true, hasReferences: false, fallback: true, sources: {} },
    ]
    const benchmarks = [
      { id: "case-1", query: "test query one", mode: "quick" as const, category: "quick", minExpectedChars: 100, minExpectedDR: 1 },
      { id: "case-2", query: "test query two", mode: "standard" as const, category: "tutorial", minExpectedChars: 200, minExpectedDR: 2 },
    ]
    const metrics = aggregateMetrics(cases, benchmarks)

    expect(metrics.avgSummaryChars).toBe(150)
    expect(metrics.avgQualityScore).toBe(8)
    expect(metrics.avgCoverageScore).toBe(8.5)
    expect(metrics.avgDRSuccessRate).toBeCloseTo(0.88)
    expect(metrics.sitemapHitRate).toBe(0.5)
    expect(metrics.githubHitRate).toBe(0.5)
    expect(metrics.referenceAppendRate).toBe(0.5)
    expect(metrics.fallbackRate).toBe(0.5)
    expect(metrics.zeroDRRate).toBe(0)
  })

  it("should compute diff between metrics", () => {
    const before: any = {
      avgSummaryChars: 1000, avgQualityScore: 6, avgCoverageScore: 5,
      avgDRSuccessRate: 0.6, sitemapHitRate: 0.3, githubHitRate: 0.4,
      referenceAppendRate: 0.5, fallbackRate: 0.2, zeroDRRate: 0.1,
      perCase: [],
    }
    const after: any = {
      avgSummaryChars: 1500, avgQualityScore: 8, avgCoverageScore: 7,
      avgDRSuccessRate: 0.8, sitemapHitRate: 0.5, githubHitRate: 0.6,
      referenceAppendRate: 0.7, fallbackRate: 0.1, zeroDRRate: 0.0,
      perCase: [],
    }
    const diff = diffMetrics(before, after)

    expect(diff.avgQualityScore.improved).toBe(true)
    expect(diff.avgQualityScore.delta).toBe(2)
    expect(diff.avgCoverageScore.improved).toBe(true)
    expect(diff.avgDRSuccessRate.improved).toBe(true)
    expect(diff.fallbackRate.improved).toBe(true)
    expect(diff.fallbackRate.delta).toBeLessThan(0)
    expect(diff.zeroDRRate.improved).toBe(true)
    expect(diff.zeroDRRate.delta).toBeLessThan(0)
  })

  it("should identify quality regressions in diff", () => {
    const before: any = {
      avgSummaryChars: 2000, avgQualityScore: 8, avgCoverageScore: 8,
      avgDRSuccessRate: 0.9, sitemapHitRate: 0.5, githubHitRate: 0.5,
      referenceAppendRate: 0.7, fallbackRate: 0.1, zeroDRRate: 0.0,
      perCase: [],
    }
    const after: any = {
      avgSummaryChars: 500, avgQualityScore: 4, avgCoverageScore: 3,
      avgDRSuccessRate: 0.3, sitemapHitRate: 0.1, githubHitRate: 0.1,
      referenceAppendRate: 0.2, fallbackRate: 0.5, zeroDRRate: 0.3,
      perCase: [],
    }
    const diff = diffMetrics(before, after)

    expect(diff.avgQualityScore.improved).toBe(false)
    expect(diff.avgCoverageScore.improved).toBe(false)
    expect(diff.avgDRSuccessRate.improved).toBe(false)
    expect(diff.fallbackRate.improved).toBe(false)
    expect(diff.zeroDRRate.improved).toBe(false)
  })

  it("should handle aggregate with empty cases", () => {
    const metrics = aggregateMetrics([], [])
    expect(metrics.avgSummaryChars).toBe(0)
    expect(metrics.avgQualityScore).toBe(0)
    expect(metrics.perCase).toEqual([])
  })
})

// ─── research evolution: diagnoser ────────────────────────────
describeSuite("research evolution: diagnoser", () => {
  it("should return diagnosis from LLM", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(JSON.stringify({
        bottleneck: "Low DR success rate",
        severity: "high",
        rootCause: "Deep read fetch timeouts",
        suggestedFix: "Increase timeout in deep-read.ts",
        targetFile: "src/research/steps/deep-read.ts",
      }))),
    }))
    mock.module("../src/research/utils/json-parser.js", () => ({
      extractJsonObject: (raw: string) => {
        const match = raw.match(/\{[\s\S]*\}/)
        return match ? match[0] : null
      },
    }))

    const { diagnoseBottleneck } = await import("../src/research/evolution/diagnoser")
    const diagnosis = await diagnoseBottleneck(
      { avgSummaryChars: 500, avgQualityScore: 5, avgCoverageScore: 4, avgDRSuccessRate: 0.3, avgLoops: 2, avgTime: 30, sitemapHitRate: 0.2, githubHitRate: 0.1, referenceAppendRate: 0.3, fallbackRate: 0.5, zeroDRRate: 0.4, perCase: [] } as any,
      { baseUrl: "https://api.test.com", apiKey: "test", model: "test-model" },
    )

    expect(diagnosis.bottleneck).toBeTruthy()
    expect(diagnosis.severity).toBeTruthy()
    expect(diagnosis.rootCause).toBeTruthy()
    expect(diagnosis.suggestedFix).toBeTruthy()
  })

  it("should handle LLM call failure", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.reject(new Error("LLM unavailable"))),
    }))

    const { diagnoseBottleneck } = await import("../src/research/evolution/diagnoser")
    const diagnosis = await diagnoseBottleneck(
      { avgSummaryChars: 0, avgQualityScore: 0, avgCoverageScore: 0, avgDRSuccessRate: 0, avgLoops: 0, avgTime: 0, sitemapHitRate: 0, githubHitRate: 0, referenceAppendRate: 0, fallbackRate: 0, zeroDRRate: 0, perCase: [] } as any,
      { baseUrl: "", apiKey: "", model: "" },
    )

    expect(diagnosis.bottleneck).toContain("LLM call failed")
    expect(diagnosis.severity).toBe("low")
  })

  it("should handle unparseable LLM response", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve("not json at all")),
    }))
    mock.module("../src/research/utils/json-parser.js", () => ({
      extractJsonObject: () => null,
    }))

    const { diagnoseBottleneck } = await import("../src/research/evolution/diagnoser")
    const diagnosis = await diagnoseBottleneck(
      { avgSummaryChars: 0, avgQualityScore: 0, avgCoverageScore: 0, avgDRSuccessRate: 0, avgLoops: 0, avgTime: 0, sitemapHitRate: 0, githubHitRate: 0, referenceAppendRate: 0, fallbackRate: 0, zeroDRRate: 0, perCase: [] } as any,
      { baseUrl: "", apiKey: "", model: "" },
    )

    expect(diagnosis.bottleneck).toContain("Failed to parse")
    expect(diagnosis.severity).toBe("low")
  })
})

// ─── research evolution: orchestrator ─────────────────────────
describeSuite("research evolution: orchestrator", () => {
  let ResearchEvolutionAgent: any

  beforeAll(async () => {
    mock.module("../src/research/evolution/model-tier", () => ({
      inferModelTier: mock(() => ({
        large: { provider: "test", id: "large-model" },
        small: { provider: "test", id: "small-model" },
      })),
      tierToLlmConfig: mock((tier: any) => ({
        baseUrl: "https://api.test.com",
        apiKey: "test-key",
        model: tier.id,
      })),
    }))

    const mod = await import("../src/research/evolution/orchestrator")
    ResearchEvolutionAgent = mod.ResearchEvolutionAgent
  })

  it("should construct with config", () => {
    const agent = new ResearchEvolutionAgent({
      maxCycles: 2,
      serverUrl: "http://localhost:3000",
      model: { provider: "openai", id: "gpt-4" },
      smallModel: { provider: "openai", id: "gpt-4o-mini" },
      targetMetrics: { minAvgQuality: 7, minAvgCoverage: 7, minDRSuccessRate: 0.8, maxZeroDRRate: 0 },
    })
    expect(agent).toBeDefined()
    expect(agent.getCycles()).toEqual([])
  })

  it("should track evolution history in report", () => {
    const agent = new ResearchEvolutionAgent({
      maxCycles: 1,
      serverUrl: "http://localhost:3000",
      model: { provider: "openai", id: "gpt-4" },
      smallModel: { provider: "openai", id: "gpt-4o-mini" },
      targetMetrics: { minAvgQuality: 7, minAvgCoverage: 7, minDRSuccessRate: 0.8, maxZeroDRRate: 0 },
    })
    const report = agent.getReport()
    expect(report).toContain("Research Self-Evolution Report")
  })

  it("should respect max evolution rounds via config", () => {
    const agent = new ResearchEvolutionAgent({
      maxCycles: 3,
      serverUrl: "http://localhost:3000",
      model: { provider: "openai", id: "gpt-4" },
      smallModel: { provider: "openai", id: "gpt-4o-mini" },
      targetMetrics: { minAvgQuality: 7, minAvgCoverage: 7, minDRSuccessRate: 0.8, maxZeroDRRate: 0 },
    })
    expect(agent).toBeDefined()
  })

  it("should accept custom benchmarks", () => {
    const benchmarks = [
      { id: "custom-1", query: "test query", mode: "quick" as const, category: "test", minExpectedChars: 500, minExpectedDR: 1 },
    ]
    const agent = new ResearchEvolutionAgent(
      {
        maxCycles: 1,
        serverUrl: "http://localhost:3000",
        model: { provider: "openai", id: "gpt-4" },
        smallModel: { provider: "openai", id: "gpt-4o-mini" },
        targetMetrics: { minAvgQuality: 7, minAvgCoverage: 7, minDRSuccessRate: 0.8, maxZeroDRRate: 0 },
      },
      benchmarks,
    )
    expect(agent).toBeDefined()
  })

  it("should accept onLog callback", () => {
    const logs: string[] = []
    const agent = new ResearchEvolutionAgent(
      {
        maxCycles: 1,
        serverUrl: "http://localhost:3000",
        model: { provider: "openai", id: "gpt-4" },
        smallModel: { provider: "openai", id: "gpt-4o-mini" },
        targetMetrics: { minAvgQuality: 7, minAvgCoverage: 7, minDRSuccessRate: 0.8, maxZeroDRRate: 0 },
      },
      undefined,
      (msg: string) => logs.push(msg),
    )
    expect(agent).toBeDefined()
  })
})
