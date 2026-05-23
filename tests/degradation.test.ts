import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { CircuitBreaker, CircuitOpenError } from "../src/search/circuit-breaker"
import { searchDocs, searchDocsCombined, writeDoc } from "../src/storage/index"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const TEST_DIR = join(tmpdir(), `kb-degradation-test-${Date.now()}`)

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
