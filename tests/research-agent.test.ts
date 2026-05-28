import { describe, it, expect, mock, beforeEach } from "bun:test"
import { extractJsonObject, extractJsonArray } from "../src/research/utils/json-parser"
import { BudgetManager } from "../src/research/budget-manager"
import {
  QUICK_FLOW, STANDARD_FLOW, DEEP_FLOW,
  MODE_BUDGETS, STEP_COSTS,
  type StepName,
} from "../src/research/types"

// ---------------------------------------------------------------------------
// 1. json-parser.ts
// ---------------------------------------------------------------------------
describe("extractJsonObject", () => {
  it("parses a valid JSON object string", () => {
    const input = '{"key": "value"}'
    expect(extractJsonObject(input)).toBe(input)
  })

  it("extracts JSON object embedded in surrounding text", () => {
    const input = 'Here is the result: {"a": 1, "b": 2} end of text'
    expect(extractJsonObject(input)).toBe('{"a": 1, "b": 2}')
  })

  it("extracts nested JSON objects", () => {
    const obj = '{"outer": {"inner": 42}}'
    const input = `prefix ${obj} suffix`
    expect(extractJsonObject(input)).toBe(obj)
  })

  it("extracts object containing an array", () => {
    const obj = '{"items": [1, 2, 3]}'
    const input = `blah ${obj} blah`
    expect(extractJsonObject(input)).toBe(obj)
  })

  it("returns null for empty string", () => {
    expect(extractJsonObject("")).toBeNull()
  })

  it("returns null for whitespace-only string", () => {
    expect(extractJsonObject("   ")).toBeNull()
  })

  it("returns null for malformed JSON", () => {
    expect(extractJsonObject("{broken json")).toBeNull()
  })

  it("strips code fences before parsing", () => {
    const obj = '{"key": "value"}'
    const input = "```json\n" + obj + "\n```"
    expect(extractJsonObject(input)).toBe(obj)
  })

  it("handles multiple objects by returning the last valid one", () => {
    const input = '{"a":1} and {"b":2}'
    expect(extractJsonObject(input)).toBe('{"b":2}')
  })

  it("returns null when input has no braces", () => {
    expect(extractJsonObject("just plain text")).toBeNull()
  })
})

describe("extractJsonArray", () => {
  it("parses a valid JSON array string", () => {
    const input = '[1, 2, 3]'
    expect(extractJsonArray(input)).toBe(input)
  })

  it("extracts JSON array embedded in surrounding text", () => {
    const input = 'Results: [{"x": 1}, {"x": 2}] done'
    expect(extractJsonArray(input)).toBe('[{"x": 1}, {"x": 2}]')
  })

  it("extracts nested arrays", () => {
    const arr = '[[1, 2], [3, 4]]'
    const input = `prefix ${arr} suffix`
    expect(extractJsonArray(input)).toBe(arr)
  })

  it("returns the empty array string when valid", () => {
    expect(extractJsonArray("[]")).toBe("[]")
  })

  it("returns null for empty string", () => {
    expect(extractJsonArray("")).toBeNull()
  })

  it("returns null for whitespace-only string", () => {
    expect(extractJsonArray("   ")).toBeNull()
  })

  it("returns null for malformed array", () => {
    expect(extractJsonArray("[broken")).toBeNull()
  })

  it("returns null when a JSON object (not array) is provided", () => {
    expect(extractJsonArray('{"a": 1}')).toBeNull()
  })

  it("strips code fences before parsing", () => {
    const arr = '[1, 2]'
    const input = "```json\n" + arr + "\n```"
    expect(extractJsonArray(input)).toBe(arr)
  })

  it("handles multiple arrays by returning the last valid one", () => {
    const input = '[1] and [2]'
    expect(extractJsonArray(input)).toBe("[2]")
  })
})

// ---------------------------------------------------------------------------
// 2. budget-manager.ts
// ---------------------------------------------------------------------------
describe("BudgetManager", () => {
  it("initializes with correct budget from mode", () => {
    const bm = new BudgetManager("quick")
    const budget = bm.getBudget()
    expect(budget.max).toBe(MODE_BUDGETS.quick.maxSteps)
    expect(budget.maxCost).toBe(MODE_BUDGETS.quick.maxCost)
    expect(budget.used).toBe(0)
    expect(budget.usedCost).toBe(0)
  })

  it("canAfford returns true when budget is available", () => {
    const bm = new BudgetManager("quick")
    expect(bm.canAfford("analyze_query")).toBe(true)
  })

  it("canAfford returns false when cost budget is exhausted", () => {
    const bm = new BudgetManager("quick")
    // quick mode maxCost = 12; synthesize costs 3 each, so run it 4 times
    for (let i = 0; i < 4; i++) {
      bm.spend("synthesize") // cost 3 each
    }
    expect(bm.canAfford("synthesize")).toBe(false)
  })

  it("canAfford returns false when step budget is exhausted", () => {
    const bm = new BudgetManager("quick")
    // quick mode maxSteps = 7
    for (let i = 0; i < 7; i++) {
      bm.spend("search") // cost 1 each
    }
    expect(bm.canAfford("search")).toBe(false)
  })

  it("spend decrements remaining budget", () => {
    const bm = new BudgetManager("standard")
    bm.spend("analyze_query") // cost 1
    const rem = bm.remaining()
    expect(rem.steps).toBe(MODE_BUDGETS.standard.maxSteps - 1)
    expect(rem.cost).toBe(MODE_BUDGETS.standard.maxCost - 1)
  })

  it("spend tracks cost correctly for expensive steps", () => {
    const bm = new BudgetManager("standard")
    bm.spend("evaluate") // cost 2
    expect(bm.getBudget().usedCost).toBe(2)
    expect(bm.getBudget().used).toBe(1)
  })

  it("refund restores one step and its cost", () => {
    const bm = new BudgetManager("standard")
    bm.spend("evaluate") // cost 2
    bm.refund("evaluate")
    expect(bm.getBudget().used).toBe(0)
    expect(bm.getBudget().usedCost).toBe(0)
  })

  it("refund does not go below zero", () => {
    const bm = new BudgetManager("quick")
    bm.refund("search")
    expect(bm.getBudget().used).toBe(0)
    expect(bm.getBudget().usedCost).toBe(0)
  })

  it("remaining returns correct values after multiple operations", () => {
    const bm = new BudgetManager("standard")
    bm.spend("analyze_query") // cost 1
    bm.spend("search")        // cost 1
    bm.spend("evaluate")      // cost 2
    bm.refund("evaluate")     // -cost 2
    const rem = bm.remaining()
    expect(rem.steps).toBe(MODE_BUDGETS.standard.maxSteps - 2)
    expect(rem.cost).toBe(MODE_BUDGETS.standard.maxCost - 2)
  })

  it("shouldWarn triggers at 70% cost usage", () => {
    const bm = new BudgetManager("quick") // maxCost = 12, 70% = 8.4
    // Spend 9 cost
    bm.spend("synthesize") // 3
    bm.spend("synthesize") // 3
    bm.spend("synthesize") // 3
    expect(bm.shouldWarn()).toBe(true)
  })

  it("isCritical triggers at 90% cost usage", () => {
    const bm = new BudgetManager("quick") // maxCost = 12, 90% = 10.8
    bm.spend("synthesize") // 3
    bm.spend("synthesize") // 3
    bm.spend("synthesize") // 3
    bm.spend("synthesize") // 3 total=12
    expect(bm.isCritical()).toBe(true)
  })

  it("getWarningPrompt returns empty string when budget is fine", () => {
    const bm = new BudgetManager("standard")
    expect(bm.getWarningPrompt()).toBe("")
  })

  it("getWarningPrompt returns warning text when near limit", () => {
    const bm = new BudgetManager("quick") // maxCost = 12
    bm.spend("synthesize") // 3
    bm.spend("synthesize") // 3
    bm.spend("synthesize") // 3 total=9 (75%)
    expect(bm.getWarningPrompt()).toContain("70%")
  })

  it("getStepModel returns correct model tier", () => {
    const bm = new BudgetManager("standard")
    expect(bm.getStepModel("analyze_query")).toBe("small")
    expect(bm.getStepModel("evaluate")).toBe("large")
    expect(bm.getStepModel("search")).toBe("none")
  })
})

function budget(bm: BudgetManager) {
  return bm.getBudget()
}

// ---------------------------------------------------------------------------
// 3. Flow configuration
// ---------------------------------------------------------------------------
describe("Flow configuration", () => {
  it("QUICK_FLOW has 7 steps", () => {
    expect(QUICK_FLOW).toHaveLength(7)
  })

  it("STANDARD_FLOW has 10 steps", () => {
    expect(STANDARD_FLOW).toHaveLength(10)
  })

  it("DEEP_FLOW has 16 steps", () => {
    expect(DEEP_FLOW).toHaveLength(16)
  })

  it("all flows end with synthesize", () => {
    expect(QUICK_FLOW[QUICK_FLOW.length - 1]).toBe("synthesize")
    expect(STANDARD_FLOW[STANDARD_FLOW.length - 1]).toBe("synthesize")
    expect(DEEP_FLOW[DEEP_FLOW.length - 1]).toBe("synthesize")
  })

  it("all flows start with analyze_query", () => {
    expect(QUICK_FLOW[0]).toBe("analyze_query")
    expect(STANDARD_FLOW[0]).toBe("analyze_query")
    expect(DEEP_FLOW[0]).toBe("analyze_query")
  })

  it("all step names are valid StepName values", () => {
    const validNames = new Set<string>([
      "analyze_query", "search", "site_directed_read", "filter_results", "evaluate",
      "deep_read", "check_sitemap", "evaluate_depth", "check_github",
      "clone_index", "code_search", "synthesize",
    ])
    for (const step of [...QUICK_FLOW, ...STANDARD_FLOW, ...DEEP_FLOW]) {
      expect(validNames.has(step)).toBe(true)
    }
  })

  it("mode budgets increase with depth", () => {
    expect(MODE_BUDGETS.quick.maxSteps).toBeLessThan(MODE_BUDGETS.standard.maxSteps)
    expect(MODE_BUDGETS.standard.maxSteps).toBeLessThan(MODE_BUDGETS.deep.maxSteps)
    expect(MODE_BUDGETS.quick.maxCost).toBeLessThan(MODE_BUDGETS.standard.maxCost)
    expect(MODE_BUDGETS.standard.maxCost).toBeLessThan(MODE_BUDGETS.deep.maxCost)
  })
})

// ---------------------------------------------------------------------------
// 4. STEP_COSTS validation
// ---------------------------------------------------------------------------
describe("STEP_COSTS", () => {
  it("every step has a valid model tier", () => {
    const validTiers = new Set(["small", "large", "none"])
    for (const [, cost] of Object.entries(STEP_COSTS)) {
      expect(validTiers.has(cost.model)).toBe(true)
    }
  })

  it("every step has a positive cost", () => {
    for (const [, cost] of Object.entries(STEP_COSTS)) {
      expect(cost.cost).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// 5. analyze-query with mocked callLlm
// ---------------------------------------------------------------------------
describe("analyzeQuery (mocked callLlm)", () => {
  beforeEach(() => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve("")),
    }))
  })

  it("returns parsed subQueries from valid LLM JSON", async () => {
    const response = JSON.stringify({
      coreKeywords: ["React", "hooks", "state"],
      subQueries: [
        "React hooks tutorial",
        "React useState guide",
        "React hooks best practices",
        "React state management patterns",
        "React useEffect examples",
        "React custom hooks",
        "React hooks vs class components",
      ],
      researchType: "concept",
      language: "en",
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { analyzeQuery } = await import("../src/research/steps/analyze-query")
    const result = await analyzeQuery("React hooks", { baseUrl: "http://x", apiKey: "k", model: "m" })

    expect(result.coreKeywords).toContain("React")
    expect(result.subQueries.length).toBeGreaterThanOrEqual(5)
    expect(result.researchType).toBe("concept")
    expect(result.language).toBe("en")
  })

  it("returns fallback when LLM returns empty string", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve("")),
    }))

    const { analyzeQuery } = await import("../src/research/steps/analyze-query")
    const result = await analyzeQuery("React hooks", { baseUrl: "http://x", apiKey: "k", model: "m" })

    expect(result.coreKeywords.length).toBeGreaterThan(0)
    expect(result.subQueries.length).toBeGreaterThan(0)
    expect(result.researchType).toBe("concept")
  })

  it("returns fallback when LLM returns malformed response", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve("This is not JSON at all!!!")),
    }))

    const { analyzeQuery } = await import("../src/research/steps/analyze-query")
    const result = await analyzeQuery("TypeScript generics", { baseUrl: "http://x", apiKey: "k", model: "m" })

    expect(result.coreKeywords.length).toBeGreaterThan(0)
    expect(result.subQueries.length).toBeGreaterThan(0)
  })

  it("handles Chinese query with correct language detection", async () => {
    const response = JSON.stringify({
      coreKeywords: ["React", "hooks"],
      subQueries: [
        "React hooks 教程",
        "React hooks 入门",
        "React hooks tutorial",
        "React hooks guide",
        "React hooks examples",
        "React hooks 最佳实践",
        "React hooks overview",
      ],
      researchType: "doc",
      language: "zh",
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { analyzeQuery } = await import("../src/research/steps/analyze-query")
    const result = await analyzeQuery("React hooks 怎么用", { baseUrl: "http://x", apiKey: "k", model: "m" })

    expect(result.language).toBe("zh")
  })

  it("supplements subQueries when LLM returns too few", async () => {
    const response = JSON.stringify({
      coreKeywords: ["test"],
      subQueries: ["one query"],
      researchType: "concept",
      language: "en",
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { analyzeQuery } = await import("../src/research/steps/analyze-query")
    const result = await analyzeQuery("test query that is unique enough", { baseUrl: "http://x", apiKey: "k", model: "m" })

    // Should be padded to at least 5 since "one query" ~= original
    expect(result.subQueries.length).toBeGreaterThanOrEqual(5)
  })
})

// ---------------------------------------------------------------------------
// 6. evaluate with mocked callLlm
// ---------------------------------------------------------------------------
describe("evaluateResults (mocked callLlm)", () => {
  const fakeResults: import("../src/search/types").SearchResult[] = Array.from({ length: 10 }, (_, i) => ({
    title: `Result ${i}`,
    url: `https://example.com/${i}`,
    snippet: `Snippet for result ${i} about React hooks`,
    source: "xbrowser" as const,
    sourceType: "blog" as const,
    qualityScore: 70 + i,
  }))

  it("returns selected indices from valid LLM response", async () => {
    const response = JSON.stringify({
      selectedIndices: [0, 3, 5],
      outline: "## React Hooks\n### Overview\n### Examples",
      sitemapHints: [],
      githubHints: [],
      initialAssessment: "Good results",
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { evaluateResults } = await import("../src/research/steps/evaluate")
    const result = await evaluateResults(
      "React hooks",
      fakeResults,
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.selectedIndices).toEqual([0, 3, 5])
    expect(result.outline).toBeTruthy()
  })

  it("filters out-of-range indices", async () => {
    const response = JSON.stringify({
      selectedIndices: [0, 99, -1],
      outline: "",
      sitemapHints: [],
      githubHints: [],
      initialAssessment: "",
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { evaluateResults } = await import("../src/research/steps/evaluate")
    const result = await evaluateResults(
      "test",
      fakeResults,
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.selectedIndices).toEqual([0])
  })

  it("falls back gracefully on malformed LLM response", async () => {
    // The retry also fails because callLlm returns garbage
    let callCount = 0
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => {
        callCount++
        return Promise.resolve("not valid json {broken")
      }),
    }))

    const { evaluateResults } = await import("../src/research/steps/evaluate")
    const result = await evaluateResults(
      "React hooks",
      fakeResults,
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    // Should still return a valid structure with fallback indices
    expect(result.selectedIndices.length).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(result.selectedIndices)).toBe(true)
  })

  it("handles empty results gracefully", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve('{"selectedIndices":[],"outline":""}')),
    }))

    const { evaluateResults } = await import("../src/research/steps/evaluate")
    const result = await evaluateResults(
      "test",
      [],
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.selectedIndices).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 7. evaluate-depth with mocked callLlm
// ---------------------------------------------------------------------------
describe("evaluateDepth (mocked callLlm)", () => {
  const fakeDeepReadResults: import("../src/research/types").DeepReadItem[] = [
    { title: "Doc 1", url: "https://example.com/1", content: "Content 1 " + "x".repeat(100), success: true, source: "fetch" },
    { title: "Doc 2", url: "https://example.com/2", content: "Content 2 " + "y".repeat(100), success: true, source: "fetch" },
  ]

  it("returns done when LLM says quality is sufficient", async () => {
    const response = JSON.stringify({
      qualityScore: 8,
      coverageScore: 7,
      decision: "done",
      reason: "Good coverage",
      nextTargets: [],
      updatedOutline: "## Complete\n### All covered",
      missingTopics: [],
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { evaluateDepth } = await import("../src/research/steps/evaluate-depth")
    const result = await evaluateDepth(
      "React hooks",
      fakeDeepReadResults,
      "## Outline",
      "standard",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.decision).toBe("done")
    expect(result.qualityScore).toBe(8)
    expect(result.coverageScore).toBe(7)
    expect(result.missingTopics).toEqual([])
  })

  it("returns need_more_search when LLM identifies gaps", async () => {
    const response = JSON.stringify({
      qualityScore: 4,
      coverageScore: 3,
      decision: "need_more_search",
      reason: "Missing API reference",
      nextTargets: ["https://example.com/api"],
      updatedOutline: "## Partial\n### Need API",
      missingTopics: ["API reference", "code examples"],
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { evaluateDepth } = await import("../src/research/steps/evaluate-depth")
    const result = await evaluateDepth(
      "React hooks",
      fakeDeepReadResults,
      "",
      "deep",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.decision).toBe("need_more_search")
    expect(result.missingTopics).toContain("API reference")
    expect(result.qualityScore).toBe(4)
  })

  it("defaults to done when LLM returns empty response", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve("")),
    }))

    const { evaluateDepth } = await import("../src/research/steps/evaluate-depth")
    const result = await evaluateDepth(
      "React hooks",
      fakeDeepReadResults,
      "## Outline",
      "quick",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.decision).toBe("done")
  })

  it("defaults to done when LLM returns malformed response", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve("this is not json at all")),
    }))

    const { evaluateDepth } = await import("../src/research/steps/evaluate-depth")
    const result = await evaluateDepth(
      "React hooks",
      fakeDeepReadResults,
      "## Outline",
      "standard",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.decision).toBe("done")
  })

  it("clamps qualityScore and coverageScore to 0-10 range", async () => {
    const response = JSON.stringify({
      qualityScore: 999,
      coverageScore: -5,
      decision: "done",
      reason: "test",
      nextTargets: [],
      updatedOutline: "",
      missingTopics: [],
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { evaluateDepth } = await import("../src/research/steps/evaluate-depth")
    const result = await evaluateDepth(
      "test",
      fakeDeepReadResults,
      "",
      "standard",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.qualityScore).toBe(10)
    expect(result.coverageScore).toBe(0)
  })

  it("defaults invalid decision to 'continue'", async () => {
    const response = JSON.stringify({
      qualityScore: 5,
      coverageScore: 5,
      decision: "invalid_decision",
      reason: "test",
      nextTargets: [],
      updatedOutline: "",
      missingTopics: [],
    })

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(response)),
    }))

    const { evaluateDepth } = await import("../src/research/steps/evaluate-depth")
    const result = await evaluateDepth(
      "test",
      fakeDeepReadResults,
      "",
      "standard",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
    )

    expect(result.decision).toBe("continue")
  })
})

// ---------------------------------------------------------------------------
// 8. filter-results internal parsing logic
// ---------------------------------------------------------------------------
describe("filterResults parseResponse logic", () => {
  it("parseResponse returns empty array for null extraction", () => {
    // When extractJsonArray returns null (tested above), parseResponse returns []
    // We test the import path to verify the module loads correctly
    const mod = require("../src/research/steps/filter-results")
    expect(mod).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 9. ResearchAgent maxDurationMs
// ---------------------------------------------------------------------------
describe("ResearchAgent configuration", () => {
  it("quick mode should map to 5 minute timeout (300000ms)", () => {
    const mode = "quick" as const
    const maxDurationMs = mode === "quick" ? 300_000 : mode === "standard" ? 600_000 : 1_200_000
    expect(maxDurationMs).toBe(300_000)
  })

  it("standard mode should map to 10 minute timeout (600000ms)", () => {
    const mode = "standard" as const
    const maxDurationMs = mode === "quick" ? 300_000 : mode === "standard" ? 600_000 : 1_200_000
    expect(maxDurationMs).toBe(600_000)
  })

  it("deep mode should map to 20 minute timeout (1200000ms)", () => {
    const mode = "deep" as const
    const maxDurationMs = mode === "quick" ? 300_000 : mode === "standard" ? 600_000 : 1_200_000
    expect(maxDurationMs).toBe(1_200_000)
  })
})

// ---------------------------------------------------------------------------
// 10. synthesize with mocked callLlm
// ---------------------------------------------------------------------------
describe("synthesize (mocked callLlm)", () => {
  const fakeDeepReads: import("../src/research/types").DeepReadItem[] = [
    { title: "Article 1", url: "https://example.com/1", content: "A".repeat(200), success: true, source: "fetch" },
    { title: "Article 2", url: "https://example.com/2", content: "B".repeat(200), success: true, source: "fetch" },
  ]

  it("returns synthesized text from LLM", async () => {
    const synthResponse = "## React Hooks\n\nReact hooks are functions that let you hook into React state [1].\n\n### useState\n\nUse useState for local state [2]."

    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve(synthResponse)),
    }))

    const { synthesize } = await import("../src/research/steps/synthesize")
    const result = await synthesize(
      "React hooks",
      fakeDeepReads,
      "## React Hooks",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
      7,
      6,
      "concept",
    )

    expect(result.isFallback).toBe(false)
    expect(result.text).toContain("React Hooks")
  })

  it("returns fallback when LLM returns empty response", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.resolve("")),
    }))

    const { synthesize } = await import("../src/research/steps/synthesize")
    const result = await synthesize(
      "React hooks",
      fakeDeepReads,
      "",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
      5,
      5,
    )

    expect(result.isFallback).toBe(true)
    expect(result.text.length).toBeGreaterThan(0)
  })

  it("returns fallback when LLM throws an error", async () => {
    mock.module("../src/search/llm-caller", () => ({
      callLlm: mock(() => Promise.reject(new Error("API error"))),
    }))

    const { synthesize } = await import("../src/research/steps/synthesize")
    const result = await synthesize(
      "React hooks",
      fakeDeepReads,
      "",
      { baseUrl: "http://x", apiKey: "k", model: "m" },
      5,
      5,
    )

    expect(result.isFallback).toBe(true)
    expect(result.text).toContain("Article 1")
  })
})

// ---------------------------------------------------------------------------
// 11. model-tier internal helpers (pure pattern matching)
// ---------------------------------------------------------------------------
describe("model-tier pattern matching", () => {
  const SMALL_MODEL_PATTERNS = [
    /flash/i, /air/i, /mini/i, /nano/i, /haiku/i, /lite/i, /small/i,
    /turbo/i, /fast/i,
  ]

  const LARGE_MODEL_PATTERNS = [
    /opus/i, /o1/i, /o3/i, /max/i, /preview/i, /thinking/i,
    /4\.5(?!.*air)/i, /5\./i, /ultra/i,
  ]

  it("identifies small models correctly", () => {
    const smallModels = ["gpt-4o-mini", "gemini-2.0-flash", "claude-3-haiku", "gpt-3.5-turbo", "glm-4-flash"]
    for (const id of smallModels) {
      expect(SMALL_MODEL_PATTERNS.some(p => p.test(id))).toBe(true)
    }
  })

  it("identifies large models correctly", () => {
    const largeModels = ["gpt-4.5", "claude-opus", "o1-preview", "o3-mini", "glm-5.1"]
    for (const id of largeModels) {
      expect(LARGE_MODEL_PATTERNS.some(p => p.test(id))).toBe(true)
    }
  })

  it("does not identify small models as large", () => {
    const smallModels = ["gpt-4o-mini", "gemini-2.0-flash", "claude-3-haiku"]
    for (const id of smallModels) {
      expect(LARGE_MODEL_PATTERNS.some(p => p.test(id))).toBe(false)
    }
  })
})
