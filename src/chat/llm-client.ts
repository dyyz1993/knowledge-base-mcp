import type { IncomingMessage } from "node:http"
import type { OpenAITool } from "./tools.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("chat:llm-client")

export interface ChatMessage {
  role: string
  content: string | null
  reasoning_content?: string
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: ChatMessage[],
  tools: OpenAITool[] | undefined,
  stream: boolean,
  enableWebSearch = false,
): Promise<Response> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`
  const body: Record<string, unknown> = { model: modelId, messages }
  if (tools) body.tools = tools
  if (enableWebSearch) {
    const isZhipuApi = baseUrl.includes("bigmodel.cn") || baseUrl.includes("zhipuai")
    if (isZhipuApi) {
      const existingTools = (body.tools as unknown[]) || []
      body.tools = [
        ...existingTools,
        {
          type: "web_search",
          web_search: { enable: true, search_result: true },
        },
      ]
    }
  }
  body.stream = stream
  body.stream_options = { include_usage: true }

  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    })

    if ((resp.status === 429 || resp.status >= 500) && attempt < maxRetries) {
      const backoff = Math.pow(2, attempt) * 1000
      logger.warn(`Chat API ${resp.status} on attempt ${attempt + 1}/${maxRetries + 1}, retrying in ${backoff}ms…`)
      await new Promise<void>(resolve => setTimeout(resolve, backoff))
      continue
    }

    return resp
  }

  throw new Error("Chat API: unreachable")
}

export async function* streamResponse(resp: Response): AsyncGenerator<{
  type: string
  delta?: string
  toolCalls?: unknown
  finishReason?: string
  error?: string
  usage?: TokenUsage
  webSearchResult?: unknown
}> {
  const reader = resp.body?.getReader()
  if (!reader) {
    yield { type: "error", error: "No response body" }
    return
  }

  const decoder = new TextDecoder()
  let buf = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const lines = buf.split("\n")
    buf = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed === "data: [DONE]") continue
      const sseData = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.startsWith("data:") ? trimmed.slice(5) : null
      if (sseData === null) continue

      try {
        const chunk = JSON.parse(sseData)
        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta
        if (delta?.content) {
          yield { type: "text_delta", delta: delta.content }
        }
        if (delta?.reasoning_content) {
          yield { type: "thinking_delta", delta: delta.reasoning_content }
        }
        if (delta?.tool_calls) {
          yield { type: "tool_calls_delta", toolCalls: delta.tool_calls }
        }
        if (delta?.web_search_result) {
          yield { type: "web_search_result", webSearchResult: delta.web_search_result }
        }
        if (choice.finish_reason) {
          yield { type: "finish", finishReason: choice.finish_reason }
        }
        if (chunk.usage) {
          yield {
            type: "usage",
            usage: {
              prompt_tokens: chunk.usage.prompt_tokens || 0,
              completion_tokens: chunk.usage.completion_tokens || 0,
              cache_read_tokens: chunk.usage.prompt_cache_hit_tokens || chunk.usage.cache_read_tokens || 0,
              cache_write_tokens: chunk.usage.prompt_cache_miss_tokens || chunk.usage.cache_write_tokens || 0,
            },
          }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }
  yield { type: "done" }
}

export function sanitizeChatMessages(messages: ChatMessage[]): void {
  while (messages.length > 0) {
    const last = messages[messages.length - 1]

    if (last.role === "tool") {
      const prev = messages.length >= 2 ? messages[messages.length - 2] : null
      if (prev?.role === "assistant" && prev.tool_calls && prev.tool_calls.length > 0) {
        const toolIds = new Set(prev.tool_calls.map(tc => tc.id))
        if (toolIds.has(last.tool_call_id ?? "")) break
      }
      messages.pop()
      continue
    }

    if (last.role === "assistant" && last.tool_calls && last.tool_calls.length > 0) {
      const toolCallIds = new Set(last.tool_calls.map(tc => tc.id))
      const hasResults = messages.some(
        m => m.role === "tool" && toolCallIds.has(m.tool_call_id ?? ""),
      )
      if (!hasResults) {
        if (last.content || last.reasoning_content) {
          messages[messages.length - 1] = { ...last, tool_calls: undefined }
        } else {
          messages.pop()
        }
        continue
      }
    }

    break
  }
}

export function parseToolCallArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args)
  } catch {
    return {}
  }
}

export function restoreChatContext(messages: {
  role: string
  content: string
  name?: string
  args?: string
  round?: number
  timestamp: number
  model?: string
}[]): ChatMessage[] {
  const result: ChatMessage[] = []
  let pendingToolCalls: Array<{ id: string; name: string; args: string }> = []
  let pendingAssistantContent = ""

  for (const m of messages) {
    switch (m.role) {
      case "user":
        flushPendingAssistant(result, pendingToolCalls, pendingAssistantContent)
        pendingToolCalls = []
        pendingAssistantContent = ""
        result.push({ role: "user", content: m.content })
        break

      case "assistant":
        flushPendingAssistant(result, pendingToolCalls, pendingAssistantContent)
        pendingToolCalls = []
        pendingAssistantContent = m.content || ""
        break

      case "thinking":
        break

      case "tool_call": {
        const args = m.args || "{}"
        const fakeId = m.name ? `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : ""
        pendingToolCalls.push({ id: fakeId, name: m.name || "", args })
        break
      }

      case "tool_result": {
        if (pendingToolCalls.length === 0) break
        const tc = pendingToolCalls.shift()!
        result.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: m.content,
        })
        break
      }
    }
  }
  flushPendingAssistant(result, pendingToolCalls, pendingAssistantContent)
  return result
}

function flushPendingAssistant(
  result: ChatMessage[],
  toolCalls: Array<{ id: string; name: string; args: string }>,
  content: string,
) {
  if (toolCalls.length === 0 && !content) return
  const msg: ChatMessage = { role: "assistant", content: content || null }
  if (toolCalls.length > 0) {
    msg.tool_calls = toolCalls.map(tc => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.args },
    }))
  }
  result.push(msg)
}

export async function readBodyJson(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalSize = 0
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk
    totalSize += buf.length
    if (totalSize > maxBytes) {
      throw new Error(`Request body too large (${totalSize} bytes, max ${maxBytes})`)
    }
    chunks.push(buf)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"))
}
