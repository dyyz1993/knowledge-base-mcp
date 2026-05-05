import { streamSimple, getModels } from "@dyyz1993/pi-ai"
import type { Context, Message, Model, Api } from "@dyyz1993/pi-ai"
import type { IncomingMessage, ServerResponse } from "node:http"
import { agentTools } from "./tools"
import { getConfiguredModels } from "./api-models"
import * as session from "./session"
import { generateId } from "../storage/index.js"

const SYSTEM_PROMPT = `You are a helpful AI assistant with knowledge base search capabilities.
You can search and write to a knowledge base using the available tools.
Always be concise, helpful, and accurate.`

function resolveModel(provider?: string, modelId?: string): Model<Api> | null {
  if (provider && modelId) {
    const models = getModels(provider as never)
    const found = models.find(m => m.id === modelId)
    if (found) return found
  }
  const configured = getConfiguredModels()
  if (configured.length > 0) {
    const models = getModels(configured[0].provider as never)
    const found = models.find(m => m.id === configured[0].id)
    if (found) return found
  }
  return null
}

function toMessages(msgs: { role: string; content: string; timestamp: number }[]): Message[] {
  return msgs.map(m => ({
    role: m.role as "user" | "assistant",
    content: m.content,
    timestamp: m.timestamp,
  })) as Message[]
}

export async function handleChat(req: IncomingMessage, res: ServerResponse) {
  const body = await readBodyJson(req)
  const { message, sessionId, model: modelReq } = body as { message: string; sessionId?: string; model?: { provider: string; id: string } }

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

    const model = resolveModel(modelReq?.provider || sess.model?.provider, modelReq?.id || sess.model?.id)
    if (!model) {
      send("error", { error: "No model available. Configure API keys for a provider." })
      res.end()
      return
    }

    const context: Context = {
      systemPrompt: SYSTEM_PROMPT,
      messages: toMessages(messages),
      tools: agentTools,
    }

    const stream = streamSimple(model, context)
    let assistantContent = ""

    for await (const event of stream) {
      switch (event.type) {
        case "text_delta":
          send("token", { delta: event.delta })
          assistantContent += event.delta
          break
        case "thinking_delta":
          send("thinking", { delta: event.delta })
          break
        case "toolcall_start": {
          const tc = event.partial.content[event.contentIndex]
          if (tc && "name" in tc) send("tool_call", { name: (tc as { name: string }).name, args: "" })
          break
        }
        case "toolcall_delta":
          send("tool_call_delta", { delta: event.delta })
          break
        case "toolcall_end":
          send("tool_result", { name: event.toolCall.name, args: event.toolCall.arguments })
          break
        case "done":
          send("done", { messageId: generateId() })
          break
        case "error":
          send("error", { error: event.error.errorMessage || "Stream error" })
          break
      }
    }

    if (assistantContent) {
      session.pushMessage(sess.id, {
        role: "assistant",
        content: assistantContent,
        timestamp: Date.now(),
        model: model.id,
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
