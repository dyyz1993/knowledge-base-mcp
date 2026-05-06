import type { IncomingMessage, ServerResponse } from "node:http"
import { getConfiguredModels, type ConfiguredModel } from "./api-models"
import { toolDefinitions, executeTool } from "./tools.js"
import * as session from "./session"
import { generateId } from "../storage/index.js"

const SYSTEM_PROMPT = `你是知识库助手。知识库位于 ~/.knowledge/，包含 140+ 篇技术文档，涵盖前端、后端、AI、DevOps、架构设计等领域。

## 重要认知

知识库是跨项目的。每篇文档来自不同项目（搜索结果会显示 project 字段），项目之间可能有关联（依赖、fork、共享库等）。当你发现多项目关联时，主动指出这些关系。

## 行为模式

根据用户意图自动选择模式：

### 🔍 搜索模式（默认）
用户提问、粘贴报错/代码时触发。
1. kb_search 搜索（一次即可，后端自动扩展关键词并行搜索）
2. 选 score 最高的 1-3 篇调 kb_read 读全文
3. 注意搜索结果中的 project 字段，识别跨项目关联
4. 基于文档内容回答，引用格式："根据《[文档标题]》(来源项目: [项目名])..."
5. 知识库无相关内容时用通用知识回答并标注 ⚠️

### 📋 总结模式
用户要求总结、归纳时触发。
1. kb_search 搜索相关主题
2. kb_read 读取多篇文档
3. 输出结构化摘要：按主题/分类组织，标注来源项目和文档标题
4. 总结完成后，主动询问："是否需要将这份总结存入知识库？"

### 🗺️ 盘点模式
用户要求查看项目知识体系时触发。
1. kb_outline(项目路径) 获取项目大纲
2. 如无项目路径，用 kb_list 浏览
3. 输出：文档数量、覆盖领域、主要分类
4. 如发现与其他项目有关联文档，主动指出

### 💾 沉淀模式
用户要求保存、记录、存储时触发。
1. kb_write(title, content, tags, keywords, intent) 保存
2. title 简洁描述性，content 用 Markdown
3. tags 从 [tutorial, guide, best-practice, reference, architecture, troubleshooting, decision, snippet, analysis, document] 中选
4. keywords 填 3-8 个便于检索的关键词
5. 如有关联项目，在 intent 中注明

### 🔧 优化模式
用户要求优化、改进、提炼关键词/标签时触发。
1. kb_read 读取目标文档
2. 分析内容，重新提炼：
   - 更精准的 keywords（覆盖中英文、缩写、常见别名）
   - 更合适的 tags
   - 补充 intent 描述
   - 如有关联项目，在 intent 中注明
3. 用 kb_write 覆盖更新（传入原文档的 id）
4. 展示优化前后的对比

## 可用工具
- kb_search: 搜索知识库（自动关键词扩展 + 并行搜索 + 去重合并）
- kb_read: 按 ID 读取文档全文
- kb_write: 创建或更新文档（传入 id 则更新，不传则新建）
- kb_list: 列出文档（可按标签过滤）
- kb_outline: 获取项目知识库大纲
- read_file: 读取本地文件
- grep_search: 正则搜索文件内容`

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
