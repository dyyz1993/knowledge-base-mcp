import { describe, test, expect, afterAll, beforeAll } from "bun:test"
import { createServer, IncomingMessage, ServerResponse, request as nodeRequest } from "node:http"
import { parseBody } from "../src/http/helpers.js"
import { startHttp } from "../src/http/start.js"

interface HttpResponse { status: number; body: any; headers: Record<string, string> }

function httpRequest(port: number, path: string, opts?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const { method = "GET", headers = {}, body } = opts ?? {}
    const req = nodeRequest({ hostname: "localhost", port, path, method, headers }, (res: IncomingMessage) => {
      let data = ""
      res.on("data", (chunk: Buffer) => { data += chunk.toString() })
      res.on("end", () => {
        const hdrs: Record<string, string> = {}
        for (const [k, v] of Object.entries(res.headers)) { if (typeof v === "string") hdrs[k] = v }
        let parsed: any
        try { parsed = JSON.parse(data) } catch { parsed = data }
        resolve({ status: res.statusCode ?? 0, body: parsed, headers: hdrs })
      })
    })
    req.on("error", reject)
    if (body) req.write(body)
    req.end()
  })
}

async function waitForServer(port: number, maxRetries = 80): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { status } = await httpRequest(port, "/health")
      if (status === 200) return
    } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Server on port ${port} did not start within ${maxRetries * 200}ms`)
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!server || server.closing) { resolve(); return }
    server.close((err) => {
      if (err && !(err as any).code?.includes("ERR_SERVER_NOT_RUNNING")) reject(err)
      else resolve()
    })
  })
}

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

describe("Auth middleware", () => {
  let authServer: ReturnType<typeof createServer>
  let AUTH_PORT: number
  let noAuthServer: ReturnType<typeof createServer>
  let NO_AUTH_PORT: number

  beforeAll(async () => {
    AUTH_PORT = await getAvailablePort()
    authServer = startHttp(AUTH_PORT, true, { apiKey: "test-secret" })
    await waitForServer(AUTH_PORT)
  }, { timeout: 30000 })

  afterAll(async () => {
    await closeServer(authServer)
    await closeServer(noAuthServer)
  })

  test("/health returns 200 without auth", async () => {
    const { status, body } = await httpRequest(AUTH_PORT, "/health")
    expect(status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.service).toBe("knowledge-base-mcp")
  })

  test("/api/docs returns 401 without auth", async () => {
    const { status, body } = await httpRequest(AUTH_PORT, "/api/docs")
    expect(status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  test("/api/docs returns 401 with wrong Bearer token", async () => {
    const { status, body } = await httpRequest(AUTH_PORT, "/api/docs", {
      headers: { Authorization: "Bearer wrong-token" },
    })
    expect(status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  test("/api/docs returns 200 with correct Bearer token", async () => {
    const { status } = await httpRequest(AUTH_PORT, "/api/docs", {
      headers: { Authorization: "Bearer test-secret" },
    })
    expect(status).toBe(200)
  })

  test("/mcp POST returns 401 without auth", async () => {
    const { status } = await httpRequest(AUTH_PORT, "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    })
    expect(status).toBe(401)
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

  test("start no-auth server and verify /api/docs returns 200", async () => {
    NO_AUTH_PORT = await getAvailablePort()
    noAuthServer = startHttp(NO_AUTH_PORT, true, { apiKey: undefined })
    await waitForServer(NO_AUTH_PORT)

    const { status } = await httpRequest(NO_AUTH_PORT, "/api/docs")
    expect(status).toBe(200)
  }, { timeout: 30000 })
})
