import type { IncomingMessage, ServerResponse } from "node:http"
import { json, readBody } from "../http.js"
import { loadConfig, saveConfig } from "../config.js"
import { scanSkillPaths } from "./skill-scanner.js"

export async function handleScanSkills(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = loadConfig()
  const result = scanSkillPaths(config.skills.paths)
  json(res, result)
}

export async function handleGetSkillPaths(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = loadConfig()
  json(res, { paths: config.skills.paths })
}

export async function handleUpdateSkillPaths(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req)
  const parsed = JSON.parse(body)
  if (!Array.isArray(parsed.paths)) {
    json(res, { error: "paths must be array" }, 400)
    return
  }
  const config = loadConfig()
  config.skills.paths = parsed.paths
  saveConfig(config)
  json(res, { ok: true, paths: parsed.paths })
}
