import type { IncomingMessage, ServerResponse } from "node:http"
import { json } from "../http.js"
import { detectBrowserPath } from "./browser-launcher.js"

export function handleBrowserDetect(_req: IncomingMessage, res: ServerResponse) {
  const path = detectBrowserPath()
  json(res, { path })
}
