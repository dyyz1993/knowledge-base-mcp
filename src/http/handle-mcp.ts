import { IncomingMessage, ServerResponse } from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { randomUUID } from "node:crypto"
import { readBody, json } from "./helpers.js"
import { registerTools } from "../mcp/register-tools.js"

const MAX_SESSIONS = 500
type StreamableSession = { server: McpServer, transport: StreamableHTTPServerTransport, createdAt: number }
const streamableSessions = new Map<string, StreamableSession>()
type SSESession = { server: McpServer, transport: SSEServerTransport, createdAt: number }
const sseSessions = new Map<string, SSESession>()

const SESSION_TTL = 1_800_000 // 30 minutes
setInterval(() => {
  const now = Date.now()
  for (const [sid, session] of streamableSessions) {
    if (now - session.createdAt > SESSION_TTL) {
      try { session.transport.close?.() } catch { /* ignore */ }
      streamableSessions.delete(sid)
    }
  }
  for (const [sid, session] of sseSessions) {
    if (now - session.createdAt > SESSION_TTL) {
      try { session.transport.close?.() } catch { /* ignore */ }
      sseSessions.delete(sid)
    }
  }
}, 30_000).unref()

export async function handleStreamableHttp(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const sessionId = req.headers["mcp-session-id"] as string | undefined

  if (sessionId && streamableSessions.has(sessionId)) {
    const session = streamableSessions.get(sessionId)!
    if (!(session.transport instanceof StreamableHTTPServerTransport)) {
      json(res, { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: Session uses different transport" }, id: null }, 400)
      return
    }
    await session.transport.handleRequest(req, res, body)
    return
  }

  if (!sessionId && req.method === "POST" && body && isInitializeRequest(body)) {
    if (streamableSessions.size + sseSessions.size >= MAX_SESSIONS) {
      json(res, { jsonrpc: "2.0", error: { code: -32000, message: "Service Unavailable: too many sessions" }, id: null }, 503)
      return
    }
    const server = new McpServer({ name: "knowledge-base", version: "1.0.0" })
    registerTools(server)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        streamableSessions.set(sid, { server, transport, createdAt: Date.now() })
      },
    })
    transport.onclose = () => {
      if (transport.sessionId) streamableSessions.delete(transport.sessionId)
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
    return
  }

  json(res, { jsonrpc: "2.0", error: { code: -32000, message: "Bad Request: No valid session ID" }, id: null }, 400)
}

export async function handleSSE(req: IncomingMessage, res: ServerResponse) {
  if (streamableSessions.size + sseSessions.size >= MAX_SESSIONS) {
    json(res, { error: "Service Unavailable: too many sessions" }, 503)
    return
  }
  const transport = new SSEServerTransport("/messages", res)
  const now = Date.now()
  sseSessions.set(transport.sessionId, { server: null!, transport, createdAt: now })
  res.on("close", () => sseSessions.delete(transport.sessionId))
  const server = new McpServer({ name: "knowledge-base", version: "1.0.0" })
  registerTools(server)
  sseSessions.set(transport.sessionId, { server, transport, createdAt: now })
  await server.connect(transport)
}

export async function handleSSEMessage(req: IncomingMessage, res: ServerResponse, body: unknown) {
  const url = new URL(req.url!, `http://${req.headers.host}`)
  const sid = url.searchParams.get("sessionId")
  if (!sid) {
    json(res, { error: "Missing sessionId" }, 400)
    return
  }
  const session = sseSessions.get(sid)
  if (!session || !(session.transport instanceof SSEServerTransport)) {
    json(res, { error: "Session not found" }, 404)
    return
  }
  await session.transport.handlePostMessage(req, res, body)
}
