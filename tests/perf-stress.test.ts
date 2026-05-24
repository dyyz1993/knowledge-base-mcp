import { describe, it, expect, beforeAll } from "bun:test"

const BASE_URL = "http://localhost:19877"
const TIMEOUT_MS = 10000

async function fetchJson(path: string) {
  const res = await fetch(`${BASE_URL}${path}`)
  expect(res.status).toBe(200)
  return res.json()
}

async function measureFetch(path: string): Promise<{ status: number; elapsed: number; data?: any }> {
  const start = performance.now()
  const res = await fetch(`${BASE_URL}${path}`)
  const elapsed = performance.now() - start
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : undefined
  return { status: res.status, elapsed, data }
}

describe("Performance benchmarks", () => {
  let serverAvailable = false

  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) })
      if (res.status === 200) serverAvailable = true
    } catch {
      serverAvailable = false
    }
  })

  describe("Single request latency", () => {
    it("single search should complete in <1000ms", async () => {
      if (!serverAvailable) return
      const { status, elapsed } = await measureFetch("/api/search?q=TypeScript&limit=5")
      expect(status).toBe(200)
      expect(elapsed).toBeLessThan(1000)
    }, TIMEOUT_MS)

    it("keyword search should complete in <1000ms", async () => {
      if (!serverAvailable) return
      const { status, elapsed } = await measureFetch("/api/search?q=knowledge&limit=5&mode=keyword")
      expect(status).toBe(200)
      expect(elapsed).toBeLessThan(1000)
    }, TIMEOUT_MS)

    it("health check should complete in <50ms", async () => {
      if (!serverAvailable) return
      const { status, elapsed } = await measureFetch("/health")
      expect(status).toBe(200)
      expect(elapsed).toBeLessThan(50)
    }, TIMEOUT_MS)

    it("config endpoint should complete in <50ms", async () => {
      if (!serverAvailable) return
      const { status, elapsed } = await measureFetch("/api/config")
      expect(status).toBe(200)
      expect(elapsed).toBeLessThan(50)
    }, TIMEOUT_MS)

    it("docs list should complete in <100ms", async () => {
      if (!serverAvailable) return
      const { status, elapsed } = await measureFetch("/api/docs?limit=20")
      expect(status).toBe(200)
      expect(elapsed).toBeLessThan(100)
    }, TIMEOUT_MS)

    it("stats should complete in <50ms", async () => {
      if (!serverAvailable) return
      const { status, elapsed } = await measureFetch("/api/stats")
      expect(status).toBe(200)
      expect(elapsed).toBeLessThan(50)
    }, TIMEOUT_MS)
  })

  describe("Concurrent load", () => {
    it("should handle 20 concurrent searches within 30s", async () => {
      if (!serverAvailable) return
      const start = performance.now()
      const promises = Array.from({ length: 20 }, (_, i) =>
        fetch(`${BASE_URL}/api/search?q=concurrent${i}&limit=3`)
      )
      const results = await Promise.all(promises)
      const elapsed = performance.now() - start

      for (const r of results) {
        expect(r.status).toBe(200)
      }
      expect(elapsed).toBeLessThan(30000)
    }, 60000)

    it("should handle 50 concurrent read-only requests", async () => {
      if (!serverAvailable) return
      const start = performance.now()
      const promises = [
        ...Array.from({ length: 20 }, (_, i) =>
          fetch(`${BASE_URL}/api/search?q=mix${i}&limit=3`)
        ),
        ...Array.from({ length: 15 }, () =>
          fetch(`${BASE_URL}/api/docs?limit=5`)
        ),
        ...Array.from({ length: 10 }, () =>
          fetch(`${BASE_URL}/api/config`)
        ),
        ...Array.from({ length: 5 }, () =>
          fetch(`${BASE_URL}/health`)
        ),
      ]
      const results = await Promise.all(promises)
      const elapsed = performance.now() - start

      const statuses = results.map(r => r.status)
      expect(statuses.every(s => s === 200)).toBe(true)
      expect(elapsed).toBeLessThan(60000)
    }, 120000)
  })

  describe("Sequential throughput", () => {
    it("should sustain 50 sequential searches within 60s", async () => {
      if (!serverAvailable) return
      const start = performance.now()
      for (let i = 0; i < 50; i++) {
        const res = await fetch(`${BASE_URL}/api/search?q=seq${i}&limit=3`)
        expect(res.status).toBe(200)
      }
      const elapsed = performance.now() - start
      expect(elapsed).toBeLessThan(60000)
      const qps = 50000 / elapsed
      expect(qps).toBeGreaterThan(1)
    }, 120000)
  })

  describe("Search consistency", () => {
    it("same query returns deterministic results", async () => {
      if (!serverAvailable) return
      const d1 = await (await fetch(`${BASE_URL}/api/search?q=TypeScript&limit=5`)).json()
      const d2 = await (await fetch(`${BASE_URL}/api/search?q=TypeScript&limit=5`)).json()

      const ids1 = (d1.results ?? d1).map((r: any) => r.id)
      const ids2 = (d2.results ?? d2).map((r: any) => r.id)
      expect(ids1).toEqual(ids2)
    }, TIMEOUT_MS)
  })

  describe("Write performance", () => {
    it("should write a ~50KB document in <5s", async () => {
      if (!serverAvailable) return
      const content = "Large doc content line. ".repeat(2000)
      const start = performance.now()
      const res = await fetch(`${BASE_URL}/api/docs/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Perf Test Doc ${Date.now()}`,
          content,
          tags: ["perf-test"],
          keywords: ["perf", "large"],
          intent: "Perf test",
        }),
      })
      const elapsed = performance.now() - start
      expect(res.status).toBe(200)
      expect(elapsed).toBeLessThan(5000)
    }, TIMEOUT_MS)
  })

  describe("Memory health", () => {
    it("RSS memory should be under 1GB after operations", async () => {
      if (!serverAvailable) return
      const data = await fetchJson("/health")
      expect(data.memory.rss).toBeLessThan(1024)
    }, TIMEOUT_MS)

    it("should not leak memory excessively", async () => {
      if (!serverAvailable) return
      const before = await fetchJson("/health")
      const rssBefore = before.memory.rss

      for (let i = 0; i < 20; i++) {
        await fetch(`${BASE_URL}/api/search?q=leak${i}&limit=3`)
      }

      const after = await fetchJson("/health")
      const rssAfter = after.memory.rss
      const growth = rssAfter - rssBefore
      expect(growth).toBeLessThan(500)
    }, 30000)
  })
})
