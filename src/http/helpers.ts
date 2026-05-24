import { IncomingMessage, ServerResponse } from "node:http"
import { URL } from "node:url"

const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB

export function validateUrl(targetUrl: string): { safe: boolean; reason?: string } {
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return { safe: false, reason: "Invalid URL format" }
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { safe: false, reason: `Blocked scheme: ${parsed.protocol}` }
  }

  const hostname = parsed.hostname.toLowerCase()

  const privatePatterns = [
    /^127\./, /^10\./, /^192\.168\./, /^0\.0\.0\.0$/, /^169\.254\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^::1$/, /^fe80:/i, /^fc00:/i, /^localhost$/i,
  ]

  for (const pattern of privatePatterns) {
    if (pattern.test(hostname)) {
      return { safe: false, reason: `Blocked private/internal host: ${hostname}` }
    }
  }

  return { safe: true }
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

const UA = "Mozilla/5.0 (compatible; KB-MCP/1.0)"
const TITLE_RE = /<title[^>]*>([^<]+)<\/title>/i
const MAX_CONTENT = 20000

export function extractHtmlContent(html: string, fallbackTitle = ""): { title: string; content: string } {
  const titleMatch = html.match(TITLE_RE)
  const title = titleMatch ? titleMatch[1].trim() : fallbackTitle
  let content = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => {
      const cp = Number(code)
      if (cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return "\uFFFD"
      try { return String.fromCodePoint(cp) } catch { return "\uFFFD" }
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTENT)
  return { title, content }
}

export function getApiUserAgent(): string {
  return UA
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on("data", chunk => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk
      size += buf.length
      if (size > MAX_BODY_SIZE) {
        reject(new Error("Request body too large (max 10MB)"))
        req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:19877",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:19877",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]

export function getCorsHeaders(requestOrigin?: string): Record<string, string> {
  const origins = process.env.CORS_ORIGINS
  const allowed = origins
    ? origins.split(",").map(o => o.trim())
    : DEFAULT_CORS_ORIGINS

  const origin = requestOrigin && allowed.includes(requestOrigin)
    ? requestOrigin
    : allowed[0] || "http://localhost:19877"

  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  }
}

export function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...getCorsHeaders(),
  }
  res.writeHead(status, headers)
  res.end(body)
}

export function apiError(
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
): void {
  json(res, {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  }, statusCode)
}

export function setupSSE(res: ServerResponse, requestOrigin?: string): { send: (event: string, data: unknown) => void; cleanup: () => void } {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": requestOrigin || "http://localhost:19877",
  })
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n")
  }, 10000)
  const abortCtrl = new AbortController()
  res.on("close", () => {
    clearInterval(heartbeat)
    abortCtrl.abort()
  })
  return {
    send: (event: string, data: unknown) => {
      const safeEvent = event.replace(/[\r\n]/g, "")
      res.write(`event: ${safeEvent}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    cleanup: () => {
      clearInterval(heartbeat)
    },
  }
}

/** Safe JSON parse with standard error response */
export async function parseBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
  try {
    const raw = await readBody(req)
    return JSON.parse(raw)
  } catch (e) {
    json(res, { error: e instanceof Error ? e.message : "Invalid request body" }, 400)
    return null
  }
}

export interface RateLimitTier {
  windowMs: number
  maxRequests: number
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
  limit: number
  remaining: number
}

function createRateLimiterCore(opts: RateLimitTier) {
  const hits = new Map<string, number[]>()
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs
    for (const [ip, timestamps] of hits) {
      const filtered = timestamps.filter(t => t > cutoff)
      if (filtered.length === 0) hits.delete(ip)
      else hits.set(ip, filtered)
    }
  }, opts.windowMs)
  cleanup.unref?.()

  return function check(req: IncomingMessage): RateLimitResult {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || "unknown"
    const now = Date.now()
    const cutoff = now - opts.windowMs
    const timestamps = (hits.get(ip) || []).filter(t => t > cutoff)
    if (timestamps.length >= opts.maxRequests) {
      const oldestInWindow = timestamps[0]
      const retryAfterMs = oldestInWindow + opts.windowMs - now
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000), limit: opts.maxRequests, remaining: 0 }
    }
    timestamps.push(now)
    hits.set(ip, timestamps)
    return { allowed: true, retryAfterMs: 0, limit: opts.maxRequests, remaining: opts.maxRequests - timestamps.length }
  }
}

export type RateLimitCategory = "general" | "llm" | "write"

const DEFAULT_TIERS: Record<RateLimitCategory, RateLimitTier> = {
  general: { windowMs: 60_000, maxRequests: 60 },
  llm:     { windowMs: 60_000, maxRequests: 20 },
  write:   { windowMs: 60_000, maxRequests: 30 },
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key]
  return v ? Math.max(parseInt(v, 10) || fallback, 1) : fallback
}

export function createTieredRateLimiter() {
  const tiers: Record<RateLimitCategory, RateLimitTier> = {
    general: { windowMs: 60_000, maxRequests: envInt("RATE_LIMIT_GENERAL", DEFAULT_TIERS.general.maxRequests) },
    llm:     { windowMs: 60_000, maxRequests: envInt("RATE_LIMIT_LLM", DEFAULT_TIERS.llm.maxRequests) },
    write:   { windowMs: 60_000, maxRequests: envInt("RATE_LIMIT_WRITE", DEFAULT_TIERS.write.maxRequests) },
  }
  const limiters: Record<RateLimitCategory, ReturnType<typeof createRateLimiterCore>> = {
    general: createRateLimiterCore(tiers.general),
    llm:     createRateLimiterCore(tiers.llm),
    write:   createRateLimiterCore(tiers.write),
  }

  function categorize(pathname: string): RateLimitCategory {
    if (
      pathname === "/api/chat" ||
      pathname === "/api/agent-research" ||
      pathname === "/api/ask-work-key" ||
      pathname.startsWith("/api/ask-")
    ) return "llm"
    if (
      pathname === "/api/docs" ||
      pathname === "/api/docs/write" ||
      pathname === "/api/ingest-site" ||
      pathname === "/api/ingest-url" ||
      pathname === "/api/ask-summarize"
    ) return "write"
    return "general"
  }

  return function checkRateLimit(req: IncomingMessage, pathname: string): RateLimitResult {
    const category = categorize(pathname)
    return limiters[category](req)
  }
}

/** @deprecated Use createTieredRateLimiter instead */
export function createRateLimiter(opts: { windowMs: number; maxRequests: number }) {
  const core = createRateLimiterCore(opts)
  return function checkRateLimit(req: IncomingMessage): { allowed: boolean; retryAfterMs: number } {
    const r = core(req)
    return { allowed: r.allowed, retryAfterMs: r.retryAfterMs }
  }
}
