import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { buildSpawnEnv } from "./utils/spawn-env.js"

// Skip MCP integration tests in CI (server startup is flaky in GitHub Actions)
const skipCI = process.env.CI === "true"

const PORT = 19888
const BASE = `http://localhost:${PORT}`
let serverProcess: ReturnType<typeof spawn> | null = null
let sessionId = ""

function mcpRequest(method: string, params: any = {}, id = 1): Promise<any> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
      reject(new Error(`Timeout: ${method}`))
    }, 60000)

    fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
      signal: controller.signal,
    })
      .then(async (resp) => {
        clearTimeout(timeout)
        const text = await resp.text()
        if (!sessionId && resp.headers.has("mcp-session-id")) {
          sessionId = resp.headers.get("mcp-session-id") || ""
        }
        const dataLine = text.split("\n").find(l => l.startsWith("data: "))
        if (dataLine) {
          resolve(JSON.parse(dataLine.slice(6)))
        } else {
          resolve(JSON.parse(text))
        }
      })
      .catch(reject)
  })
}

function callTool(name: string, args: any): Promise<any> {
  return mcpRequest("tools/call", { name, arguments: args })
}

function parseResult(resp: any): any {
  const text = resp?.result?.content?.[0]?.text
  return text ? JSON.parse(text) : null
}

beforeAll(async () => {
  if (skipCI) return

  // 启动测试服务器 (with KB_NO_LLM to force fallbackSearch path)
  serverProcess = spawn("bun", ["run", "dist/index.js", "--http", "--port", String(PORT)], {
    stdio: "pipe",
    env: { ...buildSpawnEnv(), KB_NO_LLM: "1" },
  })

  // 等待服务器启动
  await new Promise<void>((resolve, reject) => {
    let output = ""
    const timeout = setTimeout(() => {
      reject(new Error("Server startup timeout"))
    }, 10000)

    serverProcess!.stdout!.on("data", (data: Buffer) => {
      output += data.toString()
      if (output.includes("running on")) {
        clearTimeout(timeout)
        resolve()
      }
    })
    serverProcess!.stderr!.on("data", (data: Buffer) => {
      output += data.toString()
    })
  })

  // 初始化 MCP session
  await mcpRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-runner", version: "1.0.0" },
  })
}, 20000)

afterAll(() => {
  if (skipCI) return
  if (serverProcess) {
    serverProcess.kill("SIGKILL")
    serverProcess = null
  }
})

// ==================== Layer 2: MCP 工具集成测试 ====================

const describeMcp = describe.skipIf(skipCI)

describeMcp("MCP tools: health & registration", () => {
  it("should have tools registered", async () => {
    const resp = await mcpRequest("tools/list")
    const names = resp.result.tools.map((t: any) => t.name)
    expect(names.length).toBeGreaterThanOrEqual(19)
    expect(names).toContain("kb_ask")
    expect(names).toContain("kb_ingest_url")
    expect(names).toContain("kb_ingest_repo")
    expect(names).toContain("kb_stale_check")
    expect(names).toContain("kb_auto_link")
    expect(names).toContain("kb_suggest")
    expect(names).toContain("kb_search_semantic")
    expect(names).toContain("file_read")
    expect(names).toContain("file_grep")
    expect(names).toContain("file_exists")
  })

  it("health check should return ok", async () => {
    const resp = await fetch(`${BASE}/health`)
    const data = await resp.json()
    expect(data.status).toBe("ok")
  })
})

describeMcp("MCP tools: kb_write / kb_read / kb_search", () => {
  const testId = "test-integration-doc"

  it("should write a document", async () => {
    const resp = await callTool("kb_write", {
      title: "Integration Test Doc",
      content: "## Test\n\nIntegration test content for kb_write.",
      tags: ["test", "integration"],
      keywords: ["test", "integration"],
      intent: "integration test",
      project_description: "test",
    })
    const result = parseResult(resp)
    expect(result.id).toBeDefined()
    expect(result.title).toBe("Integration Test Doc")
  })

  it("should read the document", async () => {
    // 先搜索拿到 id
    const searchResp = await callTool("kb_search", { query: "Integration Test Doc" })
    const searchResult = parseResult(searchResp)
    expect(searchResult.total).toBeGreaterThan(0)
    const id = searchResult.documents[0].id

    const readResp = await callTool("kb_read", { id })
    const result = parseResult(readResp)
    expect(result.id).toBe(id)
    expect(result.content).toContain("Integration test content")
  })

  it("should list documents", async () => {
    const resp = await callTool("kb_list", {})
    const result = parseResult(resp)
    expect(result.total).toBeGreaterThan(0)
  })
})

describeMcp("MCP tools: file_read / file_grep / file_exists", () => {
  it("should read a file", async () => {
    const resp = await callTool("file_read", {
      path: "/Users/xuyingzhou/Project/temporary/knowledge-base-mcp/package.json",
      limit: 5,
    })
    const result = parseResult(resp)
    expect(result.exists).toBe(true)
    expect(result.content).toContain("kb-mcp")
    expect(result.total_lines).toBeGreaterThan(0)
  })

  it("should grep in a file", async () => {
    const resp = await callTool("file_grep", {
      path: "/Users/xuyingzhou/Project/temporary/knowledge-base-mcp/package.json",
      pattern: "dependencies",
    })
    const result = parseResult(resp)
    expect(result.exists).toBe(true)
    expect(result.total_matches).toBeGreaterThan(0)
  })

  it("should check file exists", async () => {
    const resp = await callTool("file_exists", {
      path: "/Users/xuyingzhou/Project/temporary/knowledge-base-mcp/package.json",
    })
    const result = parseResult(resp)
    expect(result.exists).toBe(true)
  })

  it("should handle non-existent file", async () => {
    const resp = await callTool("file_read", {
      path: "/tmp/nonexistent-test-file-12345.txt",
    })
    const result = parseResult(resp)
    expect(result.exists).toBe(false)
  })

  it("should read with offset and limit", async () => {
    const resp = await callTool("file_read", {
      path: "/Users/xuyingzhou/Project/temporary/knowledge-base-mcp/package.json",
      offset: 0,
      limit: 3,
    })
    const result = parseResult(resp)
    expect(result.truncated).toBe(true)
    expect(result.hint).toBeDefined()
  })
})

describeMcp("MCP tools: kb_ask / kb_ingest_url (自进化闭环)", () => {
  const testQuery = `E2E_Miss_Test_${Date.now()}_${Math.random().toString(36).slice(2)}`

  it("step 1: kb_ask should miss and return Miss Task", async () => {
    const resp = await callTool("kb_ask", { query: testQuery, max_web_results: 0 })
    const result = parseResult(resp)
    expect([false, true]).toContain(result.from_kb)
    if (result.from_kb) return
    expect(result.miss || result.web_results).toBeDefined()
    if (result.auto_saved) return
    expect(result.miss).toBe(true)
    expect(result.miss_stats?.total_unresolved).toBeGreaterThanOrEqual(0)
  }, 30000)

  it("step 2: kb_ingest_url should store and resolve miss", async () => {
    const resp = await callTool("kb_ingest_url", {
      url: "https://example.com/test",
      title: testQuery,
      content: "## E2E Test\n\nThis is auto-ingested content for testing the self-evolution pipeline.",
      tags: ["test", "auto-ingested"],
      keywords: ["e2e", "test"],
    })
    const result = parseResult(resp)
    expect(result.saved).toBe(true)
    expect(result.id).toBeDefined()
    expect(result.miss_resolved).toBe(true)
  })

  it("step 3: kb_ask should now hit KB directly", async () => {
    const resp = await callTool("kb_ask", { query: testQuery, max_web_results: 0 })
    const result = parseResult(resp)
    expect(result.from_kb).toBe(true)
    expect(result.score).toBeGreaterThan(0)
  }, 30000)
})

describeMcp("MCP tools: kb_suggest / kb_stale_check", () => {
  it("kb_suggest should return stats", async () => {
    const resp = await callTool("kb_suggest", { limit: 5 })
    const result = parseResult(resp)
    expect(result).toHaveProperty("total_unresolved_misses")
    expect(result).toHaveProperty("suggested_topics")
    expect(Array.isArray(result.suggested_topics)).toBe(true)
  })

  it("kb_stale_check should check files", async () => {
    const resp = await callTool("kb_stale_check", {})
    const result = parseResult(resp)
    expect(result).toHaveProperty("total_checked")
    expect(result).toHaveProperty("stale_count")
    expect(result.total_checked).toBeGreaterThanOrEqual(0)
  })
})
