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

export function json(res: ServerResponse, data: unknown, status = 200) {
  const body = JSON.stringify(data)
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(body)
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
