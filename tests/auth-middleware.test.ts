import { describe, test, expect, afterAll, beforeAll } from "bun:test"
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { parseBody } from "../src/http/helpers.js"
import { startHttp } from "../src/http/start.js"

async function waitForServer(port: number, maxRetries = 30): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`)
      if (res.ok) return
    } catch {}
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error(`Server on port ${port} did not start within ${maxRetries * 150}ms`)
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server || server.closing) {
      resolve()
      return
    }
    server.close((err) => {
      if (err && !(err as any).code?.includes("ERR_SERVER_NOT_RUNNING")) reject(err)
      else resolve()
    })
  })
}

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

// Single describe to guarantee sequential beforeAll execution
describe("Auth middleware", () => {
  let authServer: ReturnType<typeof createServer>
  let AUTH_PORT: number
  let noAuthServer: ReturnType<typeof createServer>
  let NO_AUTH_PORT: number

  // Phase 1: Start server WITH auth
  beforeAll(async () => {
    AUTH_PORT = await getAvailablePort()
    authServer = startHttp(AUTH_PORT, true, { apiKey: "test-secret" })
    await waitForServer(AUTH_PORT)
  })

  // Cleanup both servers
  afterAll(async () => {
    await closeServer(authServer)
    await closeServer(noAuthServer)
  })

  // Tests WITH auth (server already started in beforeAll)
  test("/health returns 200 without auth", async () => {
    const res = await fetch(`http://localhost:${AUTH_PORT}/health`)
    const text = await res.text()
    // If AUTH_PORT is wrong, we'll see an HTML error page instead of JSON
    if (!text.startsWith("{")) throw new Error(`AUTH_PORT=${AUTH_PORT} returned non-JSON: ${text.slice(0, 100)}`)
    const body = JSON.parse(text)
    expect(res.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.service).toBe("knowledge-base-mcp")
  })

  test("/api/docs returns 401 without auth", async () => {
    const res = await fetch(`http://localhost:${AUTH_PORT}/api/docs`)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  test("/api/docs returns 401 with wrong Bearer token", async () => {
    const res = await fetch(`http://localhost:${AUTH_PORT}/api/docs`, {
      headers: { Authorization: "Bearer wrong-token" },
    })
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  test("/api/docs returns 200 with correct Bearer token", async () => {
    const res = await fetch(`http://localhost:${AUTH_PORT}/api/docs`, {
      headers: { Authorization: "Bearer test-secret" },
    })
    expect(res.status).toBe(200)
  })

  test("/mcp POST returns 401 without auth", async () => {
    const res = await fetch(`http://localhost:${AUTH_PORT}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    })
    expect(res.status).toBe(401)
  })

  test("malformed JSON body returns 400 via parseBody (not 500)", async () => {
    const chunks: Buffer[] = []
    const mockReq = {
      on(event: string, cb: (...args: any[]) => void) {
        if (event === "data") chunks.push(Buffer.from("this is not valid json {{{}}"))
        if (event === "end") setTimeout(cb, 0)
        if (event === "error") {}
      },
      destroy() {},
    } as unknown as IncomingMessage

    let statusCode = 0
    let responseBody: any = null
    const mockRes = {
      headersSent: false,
      writeHead(status: number) { statusCode = status },
      end(body: string) { responseBody = JSON.parse(body) },
    } as unknown as ServerResponse

    const result = await parseBody(mockReq, mockRes)
    expect(result).toBeNull()
    expect(statusCode).toBe(400)
    expect(responseBody.error).toBeDefined()
  })

  // Phase 2: Start server WITHOUT auth (sequential after auth tests)
  test("start no-auth server and verify /api/docs returns 200", async () => {
    NO_AUTH_PORT = await getAvailablePort()
    noAuthServer = startHttp(NO_AUTH_PORT, true, { apiKey: undefined })
    await waitForServer(NO_AUTH_PORT)

    const res = await fetch(`http://localhost:${NO_AUTH_PORT}/api/docs`)
    expect(res.status).toBe(200)
  })
})
