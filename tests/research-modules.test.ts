import { describe, test, expect } from "bun:test"
import { BudgetManager } from "../src/research/budget-manager"
import { extractJsonObject, extractJsonArray } from "../src/research/utils/json-parser"
import { STEP_COSTS, MODE_BUDGETS, QUICK_FLOW, STANDARD_FLOW, DEEP_FLOW } from "../src/research/types"

describe("budget-manager", () => {
  test("should track budget usage", () => {
    const bm = new BudgetManager("quick")
    const budget = bm.getBudget()
    expect(budget.max).toBe(MODE_BUDGETS.quick.maxSteps)
    expect(budget.maxCost).toBe(MODE_BUDGETS.quick.maxCost)
    expect(budget.used).toBe(0)
    expect(budget.usedCost).toBe(0)
  })

  test("should respect budget limits", () => {
    const bm = new BudgetManager("quick")
    expect(bm.canAfford("analyze_query")).toBe(true)
    bm.spend("analyze_query")
    const budget = bm.getBudget()
    expect(budget.used).toBe(1)
    expect(budget.usedCost).toBe(STEP_COSTS.analyze_query.cost)
  })

  test("should report remaining budget", () => {
    const bm = new BudgetManager("standard")
    const before = bm.remaining()
    expect(before.steps).toBe(MODE_BUDGETS.standard.maxSteps)
    expect(before.cost).toBe(MODE_BUDGETS.standard.maxCost)
    bm.spend("search")
    const after = bm.remaining()
    expect(after.steps).toBe(MODE_BUDGETS.standard.maxSteps - 1)
    expect(after.cost).toBe(MODE_BUDGETS.standard.maxCost - STEP_COSTS.search.cost)
  })

  test("should not allow spending beyond max cost", () => {
    const bm = new BudgetManager("quick")
    const maxCost = MODE_BUDGETS.quick.maxCost
    let totalCost = 0
    const steps = ["analyze_query", "search", "filter_results", "evaluate", "deep_read", "synthesize"]
    for (const step of steps) {
      if (totalCost + STEP_COSTS[step].cost <= maxCost && bm.canAfford(step)) {
        bm.spend(step)
        totalCost += STEP_COSTS[step].cost
      }
    }
    expect(bm.getBudget().usedCost).toBeLessThanOrEqual(maxCost)
  })

  test("should refund spent budget", () => {
    const bm = new BudgetManager("quick")
    bm.spend("search")
    expect(bm.getBudget().used).toBe(1)
    bm.refund("search")
    expect(bm.getBudget().used).toBe(0)
    expect(bm.getBudget().usedCost).toBe(0)
  })

  test("should warn at 70% budget usage", () => {
    const bm = new BudgetManager("quick")
    expect(bm.shouldWarn()).toBe(false)
    const quickBudget = MODE_BUDGETS.quick.maxCost
    let spent = 0
    const steps: Array<keyof typeof STEP_COSTS> = ["analyze_query", "search", "filter_results", "evaluate", "deep_read", "synthesize"]
    for (const step of steps) {
      if (spent + STEP_COSTS[step].cost <= quickBudget) {
        bm.spend(step)
        spent += STEP_COSTS[step].cost
      }
      if (spent / quickBudget >= 0.7) break
    }
    expect(bm.shouldWarn()).toBe(true)
  })

  test("should go critical at 90% budget usage", () => {
    const bm = new BudgetManager("quick")
    expect(bm.isCritical()).toBe(false)
    const quickBudget = MODE_BUDGETS.quick.maxCost
    const needed = Math.ceil(quickBudget * 0.9)
    let spent = 0
    while (spent < needed) {
      if (bm.canAfford("synthesize")) {
        bm.spend("synthesize")
        spent += STEP_COSTS.synthesize.cost
      } else if (bm.canAfford("evaluate")) {
        bm.spend("evaluate")
        spent += STEP_COSTS.evaluate.cost
      } else {
        break
      }
    }
    expect(bm.isCritical()).toBe(true)
  })

  test("getWarningPrompt should return empty string when budget is fine", () => {
    const bm = new BudgetManager("standard")
    expect(bm.getWarningPrompt()).toBe("")
  })

  test("getStepModel should return correct model type", () => {
    const bm = new BudgetManager("standard")
    expect(bm.getStepModel("search")).toBe("none")
    expect(bm.getStepModel("analyze_query")).toBe("small")
    expect(bm.getStepModel("evaluate")).toBe("large")
    expect(bm.getStepModel("synthesize")).toBe("large")
  })
})

describe("json-parser", () => {
  test("should parse valid JSON", () => {
    const input = '{"name": "test", "value": 42}'
    const result = extractJsonObject(input)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.name).toBe("test")
    expect(parsed.value).toBe(42)
  })

  test("should handle JSON in markdown code blocks", () => {
    const input = '```json\n{"key": "value"}\n```'
    const result = extractJsonObject(input)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.key).toBe("value")
  })

  test("should handle truncated JSON", () => {
    const input = 'Here is the result: {"items": [1, 2, 3'
    const result = extractJsonObject(input)
    expect(result).toBeNull()
  })

  test("should handle JSON with trailing text", () => {
    const input = '{"status": "ok"} and some trailing text'
    const result = extractJsonObject(input)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.status).toBe("ok")
  })

  test("should return null for non-JSON", () => {
    expect(extractJsonObject("")).toBeNull()
    expect(extractJsonObject("   ")).toBeNull()
    expect(extractJsonObject("just plain text")).toBeNull()
  })

  test("should handle JSON with trailing commas", () => {
    const input = '{"a": 1, "b": 2,}'
    const result = extractJsonObject(input)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.a).toBe(1)
    expect(parsed.b).toBe(2)
  })

  test("should handle JSON with single quotes", () => {
    const input = "{'key': 'value'}"
    const result = extractJsonObject(input)
    expect(result).not.toBeNull()
  })

  test("extractJsonArray should parse valid array", () => {
    const input = '[1, 2, 3]'
    const result = extractJsonArray(input)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed).toEqual([1, 2, 3])
  })

  test("extractJsonArray should return null for object", () => {
    const input = '{"a": 1}'
    const result = extractJsonArray(input)
    expect(result).toBeNull()
  })

  test("extractJsonArray should return null for empty string", () => {
    expect(extractJsonArray("")).toBeNull()
  })

  test("extractJsonArray should handle code fences", () => {
    const input = '```json\n[1, 2, 3]\n```'
    const result = extractJsonArray(input)
    expect(result).not.toBeNull()
  })

  test("should handle JSON with comments", () => {
    const input = '{"a": 1 /* comment */, "b": 2}'
    const result = extractJsonObject(input)
    expect(result).not.toBeNull()
  })

  test("should handle nested JSON objects", () => {
    const input = '{"outer": {"inner": "value"}}'
    const result = extractJsonObject(input)
    expect(result).not.toBeNull()
    const parsed = JSON.parse(result!)
    expect(parsed.outer.inner).toBe("value")
  })
})

describe("research types", () => {
  test("STEP_COSTS should have all step names", () => {
    const expectedSteps = [
      "analyze_query", "search", "filter_results", "evaluate",
      "deep_read", "check_sitemap", "evaluate_depth", "check_github",
      "clone_index", "code_search", "synthesize",
    ]
    for (const step of expectedSteps) {
      expect(STEP_COSTS[step as keyof typeof STEP_COSTS]).toBeDefined()
      expect(STEP_COSTS[step as keyof typeof STEP_COSTS].cost).toBeGreaterThanOrEqual(1)
      expect(STEP_COSTS[step as keyof typeof STEP_COSTS].model).toBeDefined()
    }
  })

  test("MODE_BUDGETS should have quick, standard, deep", () => {
    expect(MODE_BUDGETS.quick.maxSteps).toBeLessThan(MODE_BUDGETS.standard.maxSteps)
    expect(MODE_BUDGETS.standard.maxSteps).toBeLessThan(MODE_BUDGETS.deep.maxSteps)
    expect(MODE_BUDGETS.quick.maxCost).toBeLessThan(MODE_BUDGETS.standard.maxCost)
    expect(MODE_BUDGETS.standard.maxCost).toBeLessThan(MODE_BUDGETS.deep.maxCost)
  })

  test("QUICK_FLOW should contain synthesize as last step", () => {
    expect(QUICK_FLOW[QUICK_FLOW.length - 1]).toBe("synthesize")
  })

  test("STANDARD_FLOW should contain synthesize as last step", () => {
    expect(STANDARD_FLOW[STANDARD_FLOW.length - 1]).toBe("synthesize")
  })

  test("DEEP_FLOW should contain synthesize as last step", () => {
    expect(DEEP_FLOW[DEEP_FLOW.length - 1]).toBe("synthesize")
  })

  test("DEEP_FLOW should be longer than STANDARD_FLOW", () => {
    expect(DEEP_FLOW.length).toBeGreaterThan(STANDARD_FLOW.length)
  })

  test("all flows should start with analyze_query", () => {
    expect(QUICK_FLOW[0]).toBe("analyze_query")
    expect(STANDARD_FLOW[0]).toBe("analyze_query")
    expect(DEEP_FLOW[0]).toBe("analyze_query")
  })
})
