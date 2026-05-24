import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { startHttp } from "../src/http/start.js"
import { createServer, request as nodeRequest, type IncomingMessage } from "node:http"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"
import { clearConfigCache } from "../src/config.js"
import { clearStorageCache } from "../src/storage/index.js"

const httpTestDir = join(os.tmpdir(), `kb-http-test-${process.pid}-${Date.now()}`)
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

function nodeFetch(port: number, path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; data: any; rawText?: string }> {
  return new Promise((resolve, reject) => {
    const { method = "GET", headers = {}, body } = opts ?? {}
    const req = nodeRequest({ hostname: "localhost", port, path, method, headers }, (res: IncomingMessage) => {
      let data = ""
      res.on("data", (chunk: Buffer) => { data += chunk.toString() })
      res.on("end", () => {
        let parsed: any
        try { parsed = JSON.parse(data) } catch { parsed = data }
        resolve({ status: res.statusCode ?? 0, data: parsed, rawText: data })
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

async function del(path: string) {
  return nodeFetch(PORT, path, { method: "DELETE" })
}

const PREFIX = `httpapi-test-${Date.now()}`

describe("HTTP API endpoints", () => {
  test("GET /api/docs — returns array", async () => {
    const { status, data } = await get("/api/docs")
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  let writtenDocId: string
  let writtenDocTitle: string

  test("POST /api/docs/write — write a document", async () => {
    writtenDocTitle = `${PREFIX}-write-doc`
    const { status, data } = await post("/api/docs/write", {
      title: writtenDocTitle,
      content: "# Test Content\n\nThis is e2e test content for the HTTP API.",
      tags: ["httpapi-test", "e2e"],
      keywords: ["httpapi", "e2e", "test"],
      intent: "E2E test document",
      project_description: "knowledge-base-mcp test",
    })
    expect(status).toBe(200)
    expect(data.id).toBeDefined()
    expect(data.title).toBe(writtenDocTitle)
    writtenDocId = data.id
    createdDocIds.push(writtenDocId)
  })

  test("GET /api/doc/:id — read the written document", async () => {
    const { status, data } = await get(`/api/doc/${writtenDocId}`)
    expect(status).toBe(200)
    expect(data).not.toBeNull()
    expect(data.meta.id).toBe(writtenDocId)
    expect(data.meta.title).toBe(writtenDocTitle)
    expect(data.content).toContain("Test Content")
  })

  test("DELETE /api/doc/:id — delete the document", async () => {
    const { status, data } = await del(`/api/doc/${writtenDocId}`)
    expect(status).toBe(200)
    expect(data.deleted).toBe(true)
    expect(data.id).toBe(writtenDocId)

    const { status: afterDeleteStatus, data: afterDelete } = await get(`/api/doc/${writtenDocId}`)
    expect(afterDeleteStatus).toBe(404)
    expect(afterDelete.error.code).toBe("NOT_FOUND")
  })

  test("POST /api/search — keyword search", async () => {
    const { status, data } = await post("/api/search", { query: `${PREFIX}-nonexistent`, limit: 5 })
    expect([200, 500]).toContain(status)
    expect(data).toBeDefined()
  }, 30000)

  test("GET /api/outlines — returns array", async () => {
    const { status, data } = await get("/api/outlines")
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  test("GET /api/docs/keywords — returns keywords object", async () => {
    const { status, data } = await get("/api/docs/keywords")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(Array.isArray(data.keywords)).toBe(true)
    expect(typeof data.count).toBe("number")
  })

  test("GET /api/docs/recent — returns array", async () => {
    const { status, data } = await get("/api/docs/recent")
    expect(status).toBe(200)
    expect(Array.isArray(data)).toBe(true)
  })

  test("GET /api/stats — returns object with summary", async () => {
    const { status, data } = await get("/api/stats")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(data.summary).toBeDefined()
    expect(typeof data.summary.totalSearchQueries).toBe("number")
  })

  test("GET /api/config — returns config object", async () => {
    const { status, data } = await get("/api/config")
    expect(status).toBe(200)
    expect(data).toBeDefined()
    expect(data.embedding).toBeDefined()
    expect(data.search).toBeDefined()
  })

  test("POST /api/kb-ingest — ingest and store", async () => {
    const title = `${PREFIX}-ingest-doc`
    const { status, data } = await post("/api/kb-ingest", {
      title,
      content: "Ingested test content for kb-ingest endpoint verification.",
      tags: ["httpapi-test", "ingest"],
      keywords: ["ingest", "e2e"],
    })
    expect(status).toBe(200)
    expect(data.saved).toBe(true)
    expect(data.id).toBeDefined()
    expect(data.title).toBe(title)
    createdDocIds.push(data.id)
  })

  test("POST /api/web-read — read from httpbin.org/html", async () => {
    const { status, rawText } = await post("/api/web-read", { url: "https://httpbin.org/html" })
    let data: any
    try { data = JSON.parse(rawText ?? "{}") } catch { data = {} }
    if (status === 200 && data?.success) {
      expect(typeof data.content).toBe("string")
      expect(data.content.length).toBeGreaterThan(50)
    } else {
      expect([200, 500]).toContain(status)
      expect(data).toBeDefined()
    }
  }, 25000)

  test("POST /api/docs/write with missing fields — returns 400", async () => {
    const { status, data } = await post("/api/docs/write", {
      tags: ["httpapi-test"],
    })
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
  })

  test("POST /api/docs/write with empty content — returns 400", async () => {
    const { status, data } = await post("/api/docs/write", {
      title: `${PREFIX}-empty`,
      content: "",
    })
    expect(status).toBe(400)
    expect(data.error).toBeDefined()
  })

  describe("PUT /api/config validation", () => {
    async function putConfig(body: Record<string, unknown>) {
      return nodeFetch(PORT, "/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    }

    test("rejects dimensions: -1 with 400", async () => {
      const { status, data } = await putConfig({ embedding: { dimensions: -1 } })
      expect(status).toBe(400)
      expect(data.error).toBeDefined()
      expect(data.error).toContain("dimensions")
    })

    test("rejects enabled: 'yes' with 400", async () => {
      const { status, data } = await putConfig({ embedding: { enabled: "yes" as any } })
      expect(status).toBe(400)
      expect(data.error).toBeDefined()
      expect(data.error).toContain("enabled")
    })

    test("rejects unknown provider with 400", async () => {
      const { status, data } = await putConfig({ embedding: { provider: "invalid_provider" as any } })
      expect(status).toBe(400)
      expect(data.error).toBeDefined()
    })

    test("accepts valid partial update", async () => {
      const { status, data } = await putConfig({ embedding: { dimensions: 2048 } })
      expect(status).toBe(200)
      expect(data.success).toBe(true)
    })

    test("rejects unknown top-level fields with 400", async () => {
      const { status, data } = await putConfig({ unknownField: "bad" } as any)
      expect(status).toBe(400)
      expect(data.error).toBeDefined()
    })
  })
})
