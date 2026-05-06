import type { IncomingMessage, ServerResponse } from "node:http"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import * as session from "./session"
import { json, readBody } from "../http.js"

interface PiModel {
  id: string
  name?: string
  provider?: string
  api?: string
  baseUrl?: string
}

interface PiProvider {
  baseUrl?: string
  api?: string
  apiKey?: string
  models?: PiModel[]
}

interface PiModelsConfig {
  providers?: Record<string, PiProvider>
  defaultProvider?: string
  defaultModel?: string
}

export interface ConfiguredModel {
  provider: string
  id: string
  name: string
  api?: string
  baseUrl?: string
  apiKey?: string
}

function readJson(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function fromPiModelsJson(): ConfiguredModel[] {
  const cfgPath = path.join(os.homedir(), ".pi", "agent", "models.json")
  const raw = readJson(cfgPath)
  if (!raw) return []
  const cfg = raw as PiModelsConfig
  if (!cfg.providers) return []

  const results: ConfiguredModel[] = []
  for (const [name, prov] of Object.entries(cfg.providers)) {
    if (!prov.apiKey) continue
    if (prov.models) {
      for (const m of prov.models) {
        results.push({
          provider: name,
          id: m.id,
          name: m.name || m.id,
          api: prov.api,
          baseUrl: prov.baseUrl,
          apiKey: prov.apiKey,
        })
      }
    }
  }
  return results
}

function fromOpencodeConfig(): ConfiguredModel[] {
  const cfgPath = path.join(os.homedir(), ".config", "opencode", "opencode.json")
  const raw = readJson(cfgPath)
  if (!raw) return []

  const d = raw as {
    provider?: Record<string, {
      options?: { apiKey?: string; baseURL?: string; baseUrl?: string }
      npm?: string
      models?: Record<string, { name?: string }>
    }>
  }
  if (!d.provider) return []

  const results: ConfiguredModel[] = []
  for (const [name, val] of Object.entries(d.provider)) {
    if (!val?.options?.apiKey) continue
    const models = val.models
    if (models) {
      for (const [modelId, modelDef] of Object.entries(models)) {
        results.push({
          provider: name,
          id: modelId,
          name: modelDef?.name || modelId,
          api: val.npm,
          baseUrl: val.options?.baseURL || val.options?.baseUrl,
          apiKey: val.options.apiKey,
        })
      }
    }
  }
  return results
}

export function getConfiguredModels(): ConfiguredModel[] {
  const seen = new Set<string>()
  const all: ConfiguredModel[] = []

  for (const src of [fromPiModelsJson, fromOpencodeConfig]) {
    for (const m of src()) {
      const key = `${m.provider}::${m.id}`
      if (!seen.has(key)) {
        seen.add(key)
        all.push(m)
      }
    }
  }
  return all
}

export async function handleGetModels(_req: IncomingMessage, res: ServerResponse) {
  const models = getConfiguredModels().map(({ apiKey: _, ...m }) => m)
  json(res, { models, current: null })
}

export async function handleSetModel(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { sessionId, provider, id } = body as { sessionId: string; provider: string; id: string }
  if (!sessionId || !provider || !id) {
    json(res, { error: "sessionId, provider, and id are required" }, 400)
    return
  }
  session.setModel(sessionId, { provider, id })
  json(res, { ok: true, model: { provider, id } })
}
