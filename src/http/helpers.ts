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
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
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

export function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(body)
}

export function setupSSE(res: ServerResponse): { send: (event: string, data: unknown) => void; cleanup: () => void } {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
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
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
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

/** Simple in-memory rate limiter (sliding window) */
export function createRateLimiter(opts: { windowMs: number; maxRequests: number }) {
  const hits = new Map<string, number[]>()
  // Periodic cleanup of stale entries
  const cleanup = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs
    for (const [ip, timestamps] of hits) {
      const filtered = timestamps.filter(t => t > cutoff)
      if (filtered.length === 0) hits.delete(ip)
      else hits.set(ip, filtered)
    }
  }, opts.windowMs)
  cleanup.unref?.()

  return function checkRateLimit(req: IncomingMessage): { allowed: boolean; retryAfterMs: number } {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || "unknown"
    const now = Date.now()
    const cutoff = now - opts.windowMs
    const timestamps = (hits.get(ip) || []).filter(t => t > cutoff)
    if (timestamps.length >= opts.maxRequests) {
      const oldestInWindow = timestamps[0]
      const retryAfterMs = oldestInWindow + opts.windowMs - now
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) }
    }
    timestamps.push(now)
    hits.set(ip, timestamps)
    return { allowed: true, retryAfterMs: 0 }
  }
}
