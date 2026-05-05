import type { IncomingMessage, ServerResponse } from "node:http"
import { getProviders, getModels } from "@dyyz1993/pi-ai"
import * as session from "./session"
import { json, readBody } from "../http.js"

const PROVIDER_KEYS: Record<string, string[]> = {
  "anthropic": ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  "openai": ["OPENAI_API_KEY"],
  "google": ["GEMINI_API_KEY"],
  "google-vertex": ["GOOGLE_CLOUD_API_KEY"],
  "amazon-bedrock": ["AWS_PROFILE", "AWS_ACCESS_KEY_ID"],
  "mistral": ["MISTRAL_API_KEY"],
  "github-copilot": ["COPILOT_GITHUB_TOKEN", "GH_TOKEN"],
  "groq": ["GROQ_API_KEY"],
  "xai": ["XAI_API_KEY"],
  "openrouter": ["OPENROUTER_API_KEY"],
  "zai": ["ZAI_API_KEY"],
  "azure": ["AZURE_OPENAI_API_KEY"],
}

function hasKey(envs: string[]): boolean {
  return envs.some(k => !!process.env[k])
}

function configuredProviders(): string[] {
  return getProviders().filter(p => {
    const keys = PROVIDER_KEYS[p]
    if (!keys) return true
    return hasKey(keys)
  })
}

export function getConfiguredModels() {
  return configuredProviders().flatMap(p =>
    getModels(p as never).map(m => ({ provider: m.provider, id: m.id, name: m.name }))
  )
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
