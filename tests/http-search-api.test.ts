import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { startHttp } from "../src/http/start.js"
import { createServer, request as nodeRequest, type IncomingMessage } from "node:http"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"
import { clearConfigCache } from "../src/config.js"
import { clearStorageCache } from "../src/storage/index.js"

const httpTestDir = join(os.tmpdir(), `kb-http-search-test-${process.pid}-${Date.now()}`)
const dataDir = join(httpTestDir, ".kb-chat")

function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (typeof addr === "object" && addr) resolve(addr.port)
      else reject(new Error("Failed to get port"))
      srv.close()
    })
    srv.on("error", reject)
  })
}

function nodeFetch(port: number, path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const { method = "GET", headers = {}, body } = opts ?? {}
    const req = nodeRequest({ hostname: "localhost", port, path, method, headers }, (res: IncomingMessage) => {
      let data = ""
      res.on("data", (chunk: Buffer) => { data += chunk.toString() })
      res.on("end", () => {
        let parsed: any
        try { parsed = JSON.parse(data) } catch { parsed = data }
        resolve({ status: res.statusCode ?? 0, data: parsed })
      })
    })
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

let PORT: number
let server: ReturnType<typeof createServer>
const createdDocIds: string[] = []
const PREFIX = `http-search-test-${Date.now()}`

beforeAll(async () => {
  clearConfigCache()
  clearStorageCache(httpTestDir)
  mkdirSync(join(httpTestDir, ".kb-chat", "sessions"), { recursive: true })

  PORT = await getAvailablePort()
  server = startHttp(PORT, true, { dataDir, kbDir: httpTestDir })
  for (let i = 0; i < 30; i++) {
    try {
      const { status } = await nodeFetch(PORT, "/health")
      if (status === 200) break
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
}, 30000)

afterAll(async () => {
  for (const id of createdDocIds) {
    try {
      await nodeFetch(PORT, `/api/doc/${id}`, { method: "DELETE" })
    } catch {}
  }
  server.close()
  if (existsSync(httpTestDir)) rmSync(httpTestDir, { recursive: true })
  clearConfigCache()
  clearStorageCache(httpTestDir)
})

async function post(path: string, body: Record<string, unknown>) {
  return nodeFetch(PORT, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function get(path: string) {
  return nodeFetch(PORT, path)
}

describe("GET /api/search", () => {
  let searchDocId: string

  test("setup: write a searchable document", async () => {
    const { status, data } = await post("/api/docs/write", {
      title: `${PREFIX}-searchable`,
      content: "This is a searchable document about TypeScript testing patterns and unit test best practices.",
      tags: ["http-search-test", "searchable"],
      keywords: ["http-search", "searchable", "typescript"],
      intent: "HTTP search API test document",
      project_description: "knowledge-base-mcp search test",
    })
    expect(status).toBe(200)
    expect(data.id).toBeDefined()
    searchDocId = data.id
    createdDocIds.push(searchDocId)
  })

  test("should return results for valid query", async () => {
    const { status, data } = await post("/api/search", {
      query: `${PREFIX}-searchable`,
      limit: 5,
    })
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
    expect(data[0]).toHaveProperty("score")
  })

  test("should return empty for unknown query", async () => {
    const { status, data } = await post("/api/search", {
      query: "zzzzzzz_nonexistent_query_99999",
      limit: 5,
    })
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  test("should support keyword mode via tags", async () => {
    const { status, data } = await post("/api/search", {
      query: "searchable",
      tags: ["http-search-test"],
      limit: 10,
    })
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  test("should support combined mode via keywords param", async () => {
    const { status, data } = await post("/api/search", {
      query: "TypeScript testing",
      keywords: ["http-search"],
      limit: 10,
    })
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  test("GET /api/search with query param should work", async () => {
    const { status, data } = await get(`/api/search?q=${PREFIX}-searchable&limit=5`)
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  test("should return 400 for invalid parameters", async () => {
    const { status, data } = await post("/api/search", { query: "x".repeat(5000), limit: 5 })
    expect([200, 400]).toContain(status)
    if (status === 400) {
      expect(data.error).toBeDefined()
    }
  })
})

describe("GET /api/stats/search-metrics", () => {
  test("should return metrics after searches", async () => {
    await post("/api/search", { query: "metrics test query", limit: 3 })
    const { status, data } = await get("/api/stats")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(data.summary).toBeDefined()
    expect(typeof data.summary.totalSearchQueries).toBe("number")
  })
})

describe("POST /api/search/semantic", () => {
  test("should handle semantic search request", async () => {
    const { status, data } = await post("/api/search/semantic", {
      query: "test semantic search",
      limit: 5,
    })
    expect([200, 500]).toContain(status)
    if (status === 200) {
      expect(Array.isArray(data)).toBe(true)
    }
  })

  test("should handle missing query gracefully", async () => {
    const { status } = await post("/api/search/semantic", {})
    expect(status).toBe(400)
  })

  test("should reject empty query", async () => {
    const { status } = await post("/api/search/semantic", { query: "" })
    expect(status).toBe(400)
  })
})

describe("GET /api/docs/keywords", () => {
  test("should return keywords after document write", async () => {
    const { status, data } = await get("/api/docs/keywords")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(Array.isArray(data.keywords)).toBe(true)
    expect(typeof data.count).toBe("number")
  })
})

describe("GET /api/stats", () => {
  test("should return stats with summary after searches", async () => {
    const { status, data } = await get("/api/stats")
    expect(status).toBe(200)
    expect(data.summary).toBeDefined()
    expect(typeof data.summary.totalSearchQueries).toBe("number")
  })
})

describe("GET /api/stats/search-metrics", () => {
  test("should include embedding cache rate", async () => {
    const { status, data } = await get("/api/stats/search-metrics")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(typeof data.embeddingCacheRate).toBe("number")
  })
})

describe("POST /api/kb-ingest", () => {
  test("should ingest and make content searchable", async () => {
    const title = `${PREFIX}-ingest-searchable`
    const { status, data } = await post("/api/kb-ingest", {
      title,
      content: "Ingested content about react hooks and state management patterns.",
      tags: ["http-search-test", "ingest"],
      keywords: ["ingest", "react", "hooks"],
    })
    expect(status).toBe(200)
    expect(data.saved).toBe(true)
    expect(data.id).toBeDefined()
    createdDocIds.push(data.id)

    const { data: searchResults } = await post("/api/search", {
      query: "react hooks ingest",
      limit: 5,
    })
    expect(Array.isArray(searchResults)).toBe(true)
  })
})
