import type { IncomingMessage, ServerResponse } from "node:http"

export function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(data))
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", chunk => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk))
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
    req.on("error", reject)
  })
}

export async function parseBody(req: IncomingMessage, res: ServerResponse): Promise<unknown | null> {
  try {
    return JSON.parse(await readBody(req))
  } catch (e) {
    json(res, { error: e instanceof Error ? e.message : "Invalid request body" }, 400)
    return null
  }
}
