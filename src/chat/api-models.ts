import type { IncomingMessage, ServerResponse } from "node:http"
import { getProviders, getModels, getEnvApiKey } from "@dyyz1993/pi-ai"
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

interface ConfiguredModel {
  provider: string
  id: string
  name: string
  api?: string
}

function readJson(filePath: string): unknown | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function fromPiAiProviders(): ConfiguredModel[] {
  return getProviders()
    .filter(p => !!getEnvApiKey(p))
    .flatMap(p =>
      getModels(p as never).map(m => ({ provider: m.provider, id: m.id, name: m.name }))
    )
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
        })
      }
    }
  }
  return results
}

function fromOpencodeConfig(): ConfiguredModel[] {
  const cfgPath = path.join(os.homedir(), ".config", "opencode", "config.json")
  const raw = readJson(cfgPath)
  if (!raw) return []

  const d = raw as { provider?: Record<string, { options?: { apiKey?: string }; type?: string }> }
  if (!d.provider) return []

  const providerApiKeyMap = new Map<string, string>()
  for (const [name, val] of Object.entries(d.provider)) {
    const key = val?.options?.apiKey
    if (key) providerApiKeyMap.set(name, key)
  }
  if (providerApiKeyMap.size === 0) return []

  return getProviders()
    .filter(p => providerApiKeyMap.has(p))
    .flatMap(p =>
      getModels(p as never).map(m => ({ provider: m.provider, id: m.id, name: m.name }))
    )
}

export function getConfiguredModels(): ConfiguredModel[] {
  const seen = new Set<string>()
  const all: ConfiguredModel[] = []

  for (const src of [fromPiAiProviders, fromPiModelsJson, fromOpencodeConfig]) {
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
  const models = getConfiguredModels()
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
