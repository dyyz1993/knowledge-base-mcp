import type { IncomingMessage, ServerResponse } from "node:http"
import { getConfiguredModels, type ConfiguredModel } from "./api-models"
import { toolDefinitions, executeTool } from "./tools.js"
import * as session from "./session"
import { generateId } from "../storage/index.js"

const SYSTEM_PROMPT = `You are a Knowledge Base Assistant. Your primary role is to help users by searching and retrieving information from the knowledge base.

## CRITICAL RULES
1. ALWAYS call kb_search FIRST before answering any user question, even if you think you know the answer
2. After getting search results, read the most relevant documents using kb_read to get full content
3. Base your answer on the knowledge base content and cite document titles
4. If the knowledge base has no relevant results, answer from general knowledge but explicitly mention: "Note: No relevant documents found in the knowledge base, answering from general knowledge."
5. Be concise and helpful. Use markdown formatting for better readability.

## Available Tools
- kb_search: Search knowledge base documents by keywords
- kb_read: Read full content of a specific document by ID
- kb_list: List all documents, optionally filtered by tag
- read_file: Read files from the filesystem
- grep_search: Search file contents with regex patterns

## Workflow
1. User asks a question
2. Call kb_search with relevant keywords extracted from the question
3. If results found, call kb_read on the most relevant document IDs
4. Synthesize an answer based on KB content, citing sources like: "According to [Document Title]..."
5. If no results, answer from general knowledge with a disclaimer`

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

interface ChatMessage {
  role: string
  content: string | null
  tool_calls?: Array<{
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

async function callOpenAI(
  baseUrl: string,
  apiKey: string,
  modelId: string,
  messages: ChatMessage[],
  tools: typeof toolDefinitions | undefined,
  stream: boolean,
): Promise<Response> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`
  const body: Record<string, unknown> = { model: modelId, messages }
  if (tools) body.tools = tools
  body.stream = stream

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
}

async function* streamResponse(resp: Response): AsyncGenerator<{ type: string; delta?: string; toolCalls?: unknown; finishReason?: string; error?: string }> {
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
        if (choice.finish_reason) {
          yield { type: "finish", finishReason: choice.finish_reason }
        }
      } catch {
        // skip malformed chunks
      }
    }
  }
  yield { type: "done" }
}

function parseToolCallArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args)
  } catch {
    return {}
  }
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

    const chatMessages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ]

    let assistantContent = ""
    const MAX_TOOL_ROUNDS = 10

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const resp = await callOpenAI(cfg.baseUrl, cfg.apiKey, cfg.id, chatMessages, toolDefinitions, true)

      if (!resp.ok) {
        const errBody = await resp.text()
        send("error", { error: `API ${resp.status}: ${errBody.slice(0, 500)}` })
        res.end()
        return
      }

      let currentToolCalls: Array<{ id: string; name: string; args: string }> = []
      let finishReason = ""
      let thinkingContent = ""

      for await (const event of streamResponse(resp)) {
        switch (event.type) {
          case "text_delta":
            send("token", { delta: event.delta })
            assistantContent += event.delta || ""
            break
          case "thinking_delta":
            send("thinking", { delta: event.delta })
            thinkingContent += event.delta || ""
            break
          case "tool_calls_delta": {
            const deltas = event.toolCalls as Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
            for (const d of deltas) {
              while (currentToolCalls.length <= d.index) {
                currentToolCalls.push({ id: "", name: "", args: "" })
              }
              if (d.id) currentToolCalls[d.index].id = d.id
              if (d.function?.name) currentToolCalls[d.index].name = d.function.name
              if (d.function?.arguments) currentToolCalls[d.index].args += d.function.arguments
            }
            break
          }
          case "finish":
            finishReason = event.finishReason || ""
            break
          case "error":
            send("error", { error: event.error })
            break
        }
      }

      if (finishReason !== "tool_calls" || currentToolCalls.length === 0) {
        send("done", { messageId: generateId() })
        break
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: assistantContent || null,
        tool_calls: currentToolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      }
      chatMessages.push(assistantMsg)

      for (const tc of currentToolCalls) {
        const args = parseToolCallArgs(tc.args)
        send("tool_call", { name: tc.name, args: JSON.stringify(args) })

        let result: string
        try {
          result = await executeTool(tc.name, args)
        } catch (e) {
          result = `Tool error: ${e instanceof Error ? e.message : String(e)}`
        }

        send("tool_result", { name: tc.name, result })

        chatMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.name,
          content: result,
        })
      }

      assistantContent = ""
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
