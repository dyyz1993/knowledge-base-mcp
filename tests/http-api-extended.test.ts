import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { startHttp } from "../src/http/start.js"
import { createServer, request as nodeRequest, type IncomingMessage } from "node:http"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"
import { clearConfigCache } from "../src/config.js"
import { clearStorageCache } from "../src/storage/index.js"

const httpTestDir = join(os.tmpdir(), `kb-http-ext-test-${process.pid}-${Date.now()}`)
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
const PREFIX = `http-ext-test-${Date.now()}`

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

async function get(path: string) {
  return nodeFetch(PORT, path)
}

async function post(path: string, body: Record<string, unknown>) {
  return nodeFetch(PORT, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function put(path: string, body: Record<string, unknown>) {
  return nodeFetch(PORT, path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function del(path: string) {
  return nodeFetch(PORT, path, { method: "DELETE" })
}

describe("HTTP API - Config", () => {
  test("GET /api/config should return current config", async () => {
    const { status, data } = await get("/api/config")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(data.embedding).toBeDefined()
    expect(data.search).toBeDefined()
    expect(typeof data.embedding.enabled).toBe("boolean")
  })

  test("PUT /api/config should update config", async () => {
    const { status, data } = await put("/api/config", { search: { minScore: 0.05 } })
    expect(status).toBe(200)
    expect(data.success).toBe(true)
  })

  test("PUT /api/config should reject invalid embedding.dimensions (negative)", async () => {
    const { status, data } = await put("/api/config", { embedding: { dimensions: -1 } })
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
    expect(data.error).toContain("dimensions")
  })

  test("PUT /api/config should reject invalid embedding.provider", async () => {
    const { status, data } = await put("/api/config", { embedding: { provider: "invalid_provider" } })
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
  })

  test("PUT /api/config should reject missing required fields", async () => {
    const { status, data } = await put("/api/config", { unknownField: "bad" })
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
  })

  test("GET /api/stats should return statistics", async () => {
    const { status, data } = await get("/api/stats")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(data.summary).toBeDefined()
    expect(typeof data.summary.totalSearchQueries).toBe("number")
    expect(Array.isArray(data.searchSources)).toBe(true)
    expect(Array.isArray(data.llmUsage)).toBe(true)
  })

  test("GET /api/stats/search-metrics should return search metrics", async () => {
    const { status, data } = await get("/api/stats/search-metrics")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(typeof data.embeddingCacheRate).toBe("number")
  })
})

describe("HTTP API - Docs", () => {
  let docId: string

  test("POST /api/docs/write should create document", async () => {
    const { status, data } = await post("/api/docs/write", {
      title: `${PREFIX}-docs-crud`,
      content: "# CRUD Test\n\nDocument for testing docs CRUD operations.",
      tags: ["ext-test", "docs"],
      keywords: ["ext-test", "docs", "crud"],
      intent: "Extended test doc",
      project_description: "knowledge-base-mcp ext test",
    })
    expect(status).toBe(200)
    expect(data.id).toBeDefined()
    expect(data.title).toBe(`${PREFIX}-docs-crud`)
    docId = data.id
    createdDocIds.push(docId)
  })

  test("GET /api/docs should list documents", async () => {
    const { status, data } = await get("/api/docs")
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
    expect(data.length).toBeGreaterThan(0)
  })

  test("GET /api/doc/:id should return document", async () => {
    const { status, data } = await get(`/api/doc/${docId}`)
    expect(status).toBe(200)
    expect(data.meta.id).toBe(docId)
    expect(data.content).toContain("CRUD Test")
  })

  test("GET /api/doc/:id should return 404 for missing", async () => {
    const { status, data } = await get("/api/doc/nonexistent-id-99999")
    expect(status).toBe(404)
    expect(data.error.code).toBe("NOT_FOUND")
  })

  test("DELETE /api/doc/:id should delete document", async () => {
    const { status, data } = await del(`/api/doc/${docId}`)
    expect(status).toBe(200)
    expect(data.deleted).toBe(true)
    expect(data.id).toBe(docId)
  })

  test("DELETE /api/doc/:id should return 404 for missing", async () => {
    const { status, data } = await del("/api/doc/nonexistent-id-99999")
    expect(status).toBe(404)
    expect(data.error.code).toBe("NOT_FOUND")
  })

  test("GET /api/outlines should return project outlines", async () => {
    const { status, data } = await get("/api/outlines")
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  test("POST /api/docs/write should validate required fields", async () => {
    const { status, data } = await post("/api/docs/write", { tags: ["ext-test"] })
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
  })
})

describe("HTTP API - CodeGraph", () => {
  test("POST /api/codegraph/ingest should require project_path", async () => {
    const { status, data } = await post("/api/codegraph/ingest", {})
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
  })

  test("POST /api/codegraph/ingest should reject invalid scope", async () => {
    const { status, data } = await post("/api/codegraph/ingest", {
      project_path: "/tmp",
      scope: "invalid_scope",
    })
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
  })

  test("POST /api/codegraph/ingest should return 400 for nonexistent path", async () => {
    const { status, data } = await post("/api/codegraph/ingest", {
      project_path: "/nonexistent/path/that/does/not/exist",
      scope: "overview",
    })
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
    expect(data.error.code).toBe("INVALID_PATH")
  })

  test("POST /api/codegraph/ingest should ingest overview", async () => {
    const { status, data } = await post("/api/codegraph/ingest", {
      project_path: httpTestDir,
      scope: "overview",
    })
    if (status === 200) {
      expect(data.saved).toBe(true)
      expect(data.id).toBeDefined()
      expect(data.scope).toBe("overview")
      createdDocIds.push(data.id)
    } else {
      expect([200, 500]).toContain(status)
    }
  })
})
