import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { startHttp } from "../src/http/start.js"
import { createServer } from "node:http"
import { mkdirSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"

const httpTestDir = join(os.tmpdir(), `kb-http-test-${Date.now()}`)
const origKBDir = process.env.KB_DIR
const origKBDataDir = process.env.KB_DATA_DIR
process.env.KB_DIR = httpTestDir
process.env.KB_DATA_DIR = join(httpTestDir, ".kb-chat")
mkdirSync(join(httpTestDir, ".kb-chat", "sessions"), { recursive: true })

/** Get a random available port */
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

let PORT: number
let server: ReturnType<typeof createServer>
const createdDocIds: string[] = []

beforeAll(async () => {
  PORT = await getAvailablePort()
  server = startHttp(PORT, true)
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`)
      if (res.ok) break
    } catch {}
    await new Promise(r => setTimeout(r, 100))
  }
}, 30000)

afterAll(async () => {
  for (const id of createdDocIds) {
    try {
      await fetch(`http://localhost:${PORT}/api/doc/${id}`, { method: "DELETE" })
    } catch {}
  }
  server.close()
  if (existsSync(httpTestDir)) rmSync(httpTestDir, { recursive: true })
  process.env.KB_DIR = origKBDir
  process.env.KB_DATA_DIR = origKBDataDir
})

function base() { return `http://localhost:${PORT}` }

async function post(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}

async function get(path: string) {
  const res = await fetch(`${base()}${path}`)
  return { status: res.status, data: await res.json() }
}

async function del(path: string) {
  const res = await fetch(`${base()}${path}`, { method: "DELETE" })
  return { status: res.status, data: await res.json() }
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

    const { data: afterDelete } = await get(`/api/doc/${writtenDocId}`)
    expect(afterDelete).toBeNull()
  })

  test("POST /api/search — keyword search", async () => {
    const res = await fetch(`${base()}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: `${PREFIX}-nonexistent`, limit: 5 }),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json()
    expect([200, 500]).toContain(res.status)
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
    const res = await fetch(`${base()}/api/web-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://httpbin.org/html" }),
      signal: AbortSignal.timeout(20000),
    })
    const text = await res.text()
    let data: any
    try { data = JSON.parse(text) } catch { data = {} }
    if (res.status === 200 && data?.success) {
      expect(typeof data.content).toBe("string")
      expect(data.content.length).toBeGreaterThan(50)
    } else {
      expect([200, 500]).toContain(res.status)
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
      const res = await fetch(`${base()}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      return { status: res.status, data: await res.json() }
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
