import type { IncomingMessage, ServerResponse } from "node:http"
import { getConfiguredModels, type ConfiguredModel } from "./api-models"
import { toolDefinitions, executeTool } from "./tools.js"
import * as session from "./session"
import { generateId } from "../storage/index.js"
import { buildSystemPrompt } from "./prompt-builder.js"
import { loadConfig } from "../config.js"
import {
  type ChatMessage,
  type TokenUsage,
  callOpenAI,
  streamResponse,
  sanitizeChatMessages,
  parseToolCallArgs,
  restoreChatContext,
  readBodyJson,
} from "./llm-client.js"

function resolveConfiguredModel(provider?: string, modelId?: string): ConfiguredModel | null {
  const configured = getConfiguredModels()
  if (provider && modelId) {
    const found = configured.find(m => m.provider === provider && m.id === modelId)
    if (found) return found
  }
  const preferred = configured.find(m => m.id === "glm-4.5-air" && m.apiKey && m.baseUrl)
  if (preferred) return preferred
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

export { parseModelRef, resolveConfiguredModel }

export async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const safeEvent = event.replace(/[\r\n]/g, "")
    res.write(`event: ${safeEvent}\ndata: ${JSON.stringify(data)}\n\n`)
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
      { role: "system", content: buildSystemPrompt() },
      ...restoreChatContext(messages),
    ]

    const config = loadConfig()
    const enableWebSearch = config.chat?.webSearch?.enabled === true

    let assistantContent = ""
    const MAX_TOOL_ROUNDS = 10
    let totalUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      sanitizeChatMessages(chatMessages)
      const resp = await callOpenAI(cfg.baseUrl, cfg.apiKey, cfg.id, chatMessages, toolDefinitions, true, enableWebSearch)

      if (!resp.ok) {
        const errBody = await resp.text()
        if (resp.status === 429) {
          send("error", { error: `RATE_LIMITED:${cfg.id}`, hint: `当前模型 ${cfg.id} 请求频率已达上限。请在左侧模型选择器中切换到其他模型（如 glm-4.5-air）后重试。` })
        } else {
          send("error", { error: `API ${resp.status}: ${errBody.slice(0, 500)}` })
        }
        res.end()
        return
      }

      let currentToolCalls: Array<{ id: string; name: string; args: string }> = []
      let finishReason = ""
      let thinkingContent = ""

      for await (const event of streamResponse(resp)) {
        switch (event.type) {
          case "text_delta":
            send("token", { delta: event.delta, round })
            assistantContent += event.delta || ""
            break
          case "thinking_delta":
            send("thinking", { delta: event.delta, round })
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
          case "web_search_result":
            send("web_search_result", { result: event.webSearchResult, round })
            break
          case "error":
            send("error", { error: event.error })
            break
          case "usage":
            if (event.usage) {
              totalUsage.prompt_tokens += event.usage.prompt_tokens
              totalUsage.completion_tokens += event.usage.completion_tokens
              totalUsage.cache_read_tokens += event.usage.cache_read_tokens
              totalUsage.cache_write_tokens += event.usage.cache_write_tokens
            }
            break
        }
      }

      if (thinkingContent) {
        session.pushMessage(sess.id, {
          role: "thinking",
          content: thinkingContent,
          timestamp: Date.now(),
          round,
        })
      }

      if (finishReason !== "tool_calls" || currentToolCalls.length === 0) {
        const suggestionsMatch = assistantContent.match(/\[SUGGESTIONS\]\r?\n([\s\S]*?)\[\/SUGGESTIONS\]/)
          || assistantContent.match(/\[SUGGESTIONS\]\r?\n([\s\S]+)$/)

        if (suggestionsMatch) {
          const suggestionsText = suggestionsMatch[1]
          const suggestions = suggestionsText
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => /^\d+\.\s/.test(l) || /^[-•]\s/.test(l))
            .map(l => l.replace(/^(\d+\.|[-•])\s*/, ""))
            .filter(s => s.length > 0 && s.length <= 60)
            .slice(0, 3)

          assistantContent = assistantContent.replace(suggestionsMatch[0], "").trim()

          send("suggestions", suggestions)

          if (suggestions.length > 0) {
            session.pushMessage(sess.id, {
              role: "suggestions",
              content: JSON.stringify(suggestions),
              timestamp: Date.now(),
            })
          }
        }

        send("done", { messageId: generateId(), round, usage: totalUsage })

        session.pushMessage(sess.id, {
          role: "usage",
          content: JSON.stringify(totalUsage),
          timestamp: Date.now(),
        })

        break
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: assistantContent || null,
        reasoning_content: thinkingContent || undefined,
        tool_calls: currentToolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      }
      chatMessages.push(assistantMsg)

      const toolPromises = currentToolCalls.map(async (tc) => {
        const args = parseToolCallArgs(tc.args)
        send("tool_call", { id: tc.id, name: tc.name, args: JSON.stringify(args), round })

        session.pushMessage(sess.id, {
          role: "tool_call",
          content: `${tc.name}(${JSON.stringify(args)})`,
          name: tc.name,
          args: JSON.stringify(args),
          timestamp: Date.now(),
          round,
        })

        let result: string
        try {
          result = await executeTool(tc.name, args, (p) => {
            send("research_progress", { tool_name: tc.name, ...p, round })
          })
        } catch (e) {
          result = `Tool error: ${e instanceof Error ? e.message : String(e)}`
        }

        send("tool_result", { id: tc.id, name: tc.name, result, round })

        session.pushMessage(sess.id, {
          role: "tool_result",
          content: result,
          name: tc.name,
          timestamp: Date.now(),
          round,
        })

        return { tool_call_id: tc.id, name: tc.name, content: result }
      })

      const toolResults = await Promise.all(toolPromises)
      for (const tr of toolResults) {
        chatMessages.push({ role: "tool", ...tr })
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
