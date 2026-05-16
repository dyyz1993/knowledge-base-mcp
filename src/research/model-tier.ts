import type { ModelTier } from "./types"
import type { LlmConfig } from "../search/llm-caller"
import { getConfiguredModels } from "../chat/api-models"

const SMALL_MODEL_PATTERNS = [
  /flash/i, /air/i, /mini/i, /nano/i, /haiku/i, /lite/i, /small/i,
  /turbo/i, /fast/i,
]

const LARGE_MODEL_PATTERNS = [
  /opus/i, /o1/i, /o3/i, /max/i, /preview/i, /thinking/i,
  /4\.5(?!.*air)/i, /5\./i, /ultra/i,
]

export function inferModelTier(
  primaryModel: { provider: string; id: string },
  explicitSmall?: { provider: string; id: string },
): ModelTier | null {
  const configured = getConfiguredModels()

  const resolveModel = (spec: { provider: string; id: string }) => {
    const found = configured.find(
      (m) => m.provider === spec.provider && m.id === spec.id,
    )
    if (!found?.apiKey || !found?.baseUrl) return null
    return { baseUrl: found.baseUrl, apiKey: found.apiKey, model: found.id }
  }

  const large = resolveModel(primaryModel)
  if (!large) return null

  let small: { baseUrl: string; apiKey: string; model: string } | null = null

  if (explicitSmall) {
    small = resolveModel(explicitSmall)
  }

  if (!small) {
    small = findSmallModel(configured, primaryModel.provider) || large
  }

  return { small, large }
}

function findSmallModel(
  configured: Array<{ provider: string; id: string; apiKey?: string; baseUrl?: string }>,
  preferredProvider: string,
): { baseUrl: string; apiKey: string; model: string } | null {
  const providerModels = configured.filter(
    (m) => m.provider === preferredProvider && m.apiKey && m.baseUrl,
  )

  for (const m of providerModels) {
    if (SMALL_MODEL_PATTERNS.some((p) => p.test(m.id))) {
      return { baseUrl: m.baseUrl!, apiKey: m.apiKey!, model: m.id }
    }
  }

  for (const m of configured) {
    if (SMALL_MODEL_PATTERNS.some((p) => p.test(m.id)) && m.apiKey && m.baseUrl) {
      return { baseUrl: m.baseUrl!, apiKey: m.apiKey!, model: m.id }
    }
  }

  return null
}

export function tierToLlmConfig(model: { baseUrl: string; apiKey: string; model: string }): LlmConfig {
  return { baseUrl: model.baseUrl, apiKey: model.apiKey, model: model.model }
}
