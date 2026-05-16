export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export async function callLlm(
  config: LlmConfig,
  messages: Array<{ role: string; content: string }>,
  temperature = 0.3,
  maxTokens = 2000,
  timeoutMs = 30000,
): Promise<string> {
  const resp = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = (await resp.json()) as Record<string, unknown>
  const choices = data.choices as
    | Array<{ message: { content: string } }>
    | undefined
  return choices?.[0]?.message?.content ?? ""
}
