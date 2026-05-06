import type { IncomingMessage, ServerResponse } from "node:http"
import { getConfiguredModels, type ConfiguredModel } from "./api-models"
import * as session from "./session"
import { generateId } from "../storage/index.js"

const SYSTEM_PROMPT = `You are a helpful AI assistant with knowledge base search capabilities.
You can search and write to a knowledge base using the available tools.
Always be concise, helpful, and accurate.`

function resolveConfiguredModel(provider?: string, modelId?: string): ConfiguredModel | null {
  const configured = getConfiguredModels()
  if (provider && modelId) {
    const found = configured.find(m => m.provider === provider && m.id === modelId)
    if (found) return found
  }
  return configured.length > 0 ? configured[0] : null
}

function parseModelRef(model: unknown): { provider: string; id: string } | null {
  if (!model) return null
  if (typeof model === "string") {
    const idx = model.indexOf("/")
    if (idx > 0) return { provider: model.slice(0, idx), id: model.slice(idx + 1) }
    return null
  }
  const m = model as { provider?: string; id?: string }
  if (m.provider && m.id) return { provider: m.provider, id: m.id }
  return null
}

async function* streamOpenAI(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: { role: string; content: string }[],
): AsyncGenerator<{ type: string; delta?: string; error?: string }> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: modelId, messages, stream: true }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    yield { type: "error", error: `API ${resp.status}: ${body.slice(0, 500)}` }
    return
  }

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
      if (!trimmed.startsWith("data: ")) continue

      try {
        const chunk = JSON.parse(trimmed.slice(6))
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) {
          yield { type: "text_delta", delta: delta.content }
        }
        if (delta?.reasoning_content) {
          yield { type: "thinking_delta", delta: delta.reasoning_content }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  yield { type: "done" }
}

export async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const body = await readBodyJson(req)
  const { message, sessionId, model: modelReq } = body as {
    message: string
    sessionId?: string
    model?: unknown
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  })

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const { session: sess, messages } = session.getOrCreate(sessionId)

    const userMsg = { role: "user" as const, content: message, timestamp: Date.now() }
    session.pushMessage(sess.id, userMsg)

    const ref = parseModelRef(modelReq) || sess.model
    const cfg = resolveConfiguredModel(ref?.provider, ref?.id)
    if (!cfg) {
      send("error", { error: "No model available. Configure API keys for a provider." })
      res.end()
      return
    }

    if (!cfg.apiKey || !cfg.baseUrl) {
      send("error", { error: `Model ${cfg.provider}/${cfg.id} missing apiKey or baseUrl.` })
      res.end()
      return
    }

    const chatMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ]

    let assistantContent = ""
    const stream = streamOpenAI(cfg.baseUrl, cfg.apiKey, cfg.id, chatMessages)

    for await (const event of stream) {
      switch (event.type) {
        case "text_delta":
          send("token", { delta: event.delta })
          assistantContent += event.delta || ""
          break
        case "thinking_delta":
          send("thinking", { delta: event.delta })
          break
        case "done":
          send("done", { messageId: generateId() })
          break
        case "error":
          send("error", { error: event.error })
          break
      }
    }

    if (assistantContent) {
      session.pushMessage(sess.id, {
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        model: cfg.id,
      })
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal error"
    send("error", { error: msg })
  }
  res.end()
}

async function readBodyJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  return JSON.parse(Buffer.concat(chunks).toString("utf-8"))
}
