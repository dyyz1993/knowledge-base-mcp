export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/**
 * Call an OpenAI-compatible chat completions endpoint.
 *
 * - Retries up to 3 times on HTTP 429 (rate-limit) and 5xx (server error)
 *   with exponential backoff (1 s, 2 s, 4 s), as long as total elapsed time
 *   stays within `timeoutMs`.
 * - Retries network errors (DNS, connection reset, timeout) up to 3 times.
 * - Supports "thinking mode" models (e.g. zhipu glm-5.1) that return the actual
 *   answer in `reasoning_content` while `content` is empty.
 */
export async function callLlm(
  config: LlmConfig,
  messages: Array<{ role: string; content: string }>,
  temperature = 0.3,
  maxTokens = 2000,
  timeoutMs = 30000,
): Promise<string> {
  const url = `${config.baseUrl}/chat/completions`
  const body = JSON.stringify({
    model: config.model,
    messages,
    max_tokens: maxTokens,
    temperature,
  })
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  }

  const maxRetries = 3
  const start = Date.now()

  let resp: Response | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const remaining = timeoutMs - (Date.now() - start)
    if (remaining <= 0) {
      throw new Error(`LLM request timed out after ${timeoutMs}ms (retry budget exhausted)`)
    }

    try {
      resp = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(remaining),
      })
    } catch (fetchErr) {
      // Network errors (DNS, connection reset, timeout)
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt) * 1000
        console.warn(`LLM network error on attempt ${attempt + 1}/${maxRetries + 1}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}, retrying in ${backoff}ms…`)
        await new Promise<void>((resolve) => setTimeout(resolve, backoff))
        continue
      }
      throw new Error(`LLM network error after ${maxRetries + 1} attempts: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`)
    }

    // Retry on 429 (rate limit) or 5xx (server error)
    if ((resp.status === 429 || resp.status >= 500) && attempt < maxRetries) {
      const backoff = Math.pow(2, attempt) * 1000
      const afterBackoff = Date.now() - start + backoff
      if (afterBackoff >= timeoutMs) {
        console.error(`LLM ${resp.status} on attempt ${attempt + 1}/${maxRetries + 1} but no time left for retry`)
        break
      }
      console.warn(`LLM ${resp.status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${backoff}ms…`)
      await new Promise<void>((resolve) => setTimeout(resolve, backoff))
      continue
    }

    break
  }

  if (!resp) {
    throw new Error("LLM request failed: no response received")
  }

  if (!resp.ok) {
    const text = await resp.text()
    const excerpt = text.slice(0, 500)
    console.error(`LLM request failed with status ${resp.status}: ${excerpt}`)
    throw new Error(`LLM request failed (${resp.status}): ${excerpt}`)
  }

  const data = (await resp.json()) as Record<string, unknown>
  const choices = data.choices as
    | Array<{
        message: {
          content: string | null
          reasoning_content?: string
        }
      }>
    | undefined

  if (!choices || !Array.isArray(choices)) {
    console.error(`[callLlm] Unexpected response structure: ${JSON.stringify(data).slice(0, 300)}`)
    return ""
  }

  const message = choices?.[0]?.message
  if (!message) return ""

  const content = typeof message.content === "string" ? message.content.trim() : ""
  if (content.length > 0) return content

  const reasoning =
    typeof message.reasoning_content === "string" ? message.reasoning_content.trim() : ""
  if (reasoning.length > 0) return reasoning

  return ""
}
