import { IncomingMessage, ServerResponse } from "node:http"

const MAX_BODY_SIZE = 10 * 1024 * 1024 // 10MB

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
