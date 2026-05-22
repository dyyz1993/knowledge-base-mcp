import type { IncomingMessage, ServerResponse } from "node:http"
import { getConfiguredModels, type ConfiguredModel } from "./api-models"
import { toolDefinitions, executeTool } from "./tools.js"
import * as session from "./session"
import { generateId, getAllKeywords } from "../storage/index.js"

let cachedKeywords: string[] = []
let keywordsCacheTime = 0
const KEYWORDS_TTL = 5 * 60 * 1000

function getKeywordsSnapshot(): string[] {
  const now = Date.now()
  if (now - keywordsCacheTime > KEYWORDS_TTL) {
    cachedKeywords = getAllKeywords().keywords
    keywordsCacheTime = now
  }
  return cachedKeywords
}

function buildSystemPrompt(): string {
  const kw = getKeywordsSnapshot()
  const kwSection = kw.length > 0
    ? `\n## 知识库关键词索引（${kw.length} 个）\n搜索时优先使用这些关键词扩展查询，用户输入可能用别名/缩写，你应该映射到以下标准关键词：\n${kw.slice(0, 200).join("、")}${kw.length > 200 ? `...等${kw.length}个` : ""}\n`
    : ""

  return `你是知识库助手。知识库位于 ~/.knowledge/，包含 140+ 篇技术文档，涵盖前端、后端、AI、DevOps、架构设计等领域。${kwSection}

## 重要认知

**工具优先级（从高到低）：**
1. kb_search / kb_read — 知识库已有内容（优先级最高）
2. kb_research — 深度研究新主题（自动存入知识库，一次研究可反复复用）
3. browser_scrape / url_fetch — 仅当需要快速查看单个页面时使用

⚠️ 当知识库未覆盖用户主题时，优先使用 kb_research 而非 browser_scrape。browser_scrape 的结果不会存入知识库，是低效的一次性操作。

知识库是跨项目的。每篇文档来自不同项目（搜索结果会显示 project 字段），项目之间可能有关联（依赖、fork、共享库等）。当你发现多项目关联时，主动指出这些关系。

## 行为模式

根据用户意图自动选择模式：

### 🔍 搜索模式（默认）
用户提问、粘贴报错/代码时触发。
1. kb_search 搜索（一次即可，后端自动扩展关键词并行搜索）
2. 选 score 最高的 1-3 篇调 kb_read 读全文
3. 注意搜索结果中的 project 字段，识别跨项目关联
4. 基于文档内容回答，引用格式："根据《[文档标题]》(来源项目: [项目名])..."
5. 知识库无相关内容时，判断是否需要深度研究（见 🔬 研究模式）

### 🔬 研究模式
以下情况触发 kb_research（自动存入知识库，下次同类问题可直接命中）：
- 用户明确要求"研究"、"调研"、"深度分析"某个主题
- kb_search 搜索无结果或结果质量不足以回答用户问题
- 用户问的问题涉及知识库未覆盖的新技术/新领域
- 用户需要对比多个方案/产品/技术选型

使用方式：
1. 调用 kb_research(query, mode)
2. mode 选择："quick"（快速验证）、"standard"（默认）、"deep"（复杂主题）
3. 研究结果会自动存入知识库，下次同类问题可直接命中
4. 等待结果后，基于研究报告回答用户，标注"🔍 已自动深度研究"

注意：简单事实性问题不要触发研究，优先用通用知识回答。

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
1. kb_write 保存，所有字段必填（除 id 外）
2. title 简洁描述性，content 用 Markdown
3. tags 从 [tutorial, guide, best-practice, reference, architecture, troubleshooting, decision, snippet, analysis, document] 中选
4. keywords 填 3-8 个便于检索的关键词
5. intent 描述文档用途（为什么创建、什么时候有用）
6. project_path 填写项目的磁盘绝对路径
7. project_description 简要描述项目
8. related_projects 关联的其他项目路径或名称
9. related_files 关联的源码文件路径（用于过时检测）

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

### 🏗️ 项目知识沉淀流程

当用户提供以下任何一种输入时，触发项目知识沉淀流程：
- GitHub 仓库链接
- 项目目录路径
- 文档 URL
- 明确要求"分析项目"或"沉淀知识库"

#### 第一步：获取项目内容
- **URL 链接** → 用 kb_research 进行深度研究（自动存入知识库），browser_scrape 仅用于快速预览单个页面
- **GitHub 仓库** → 用 git_clone 克隆到临时目录
- **本地路径** → 直接用 scan_project 扫描

#### 第二步：项目结构扫描
用 scan_project 获取树状目录结构，重点关注：
- 入口文件（index.ts, main.py, app.ts 等）
- 配置文件（package.json, tsconfig.json, Cargo.toml 等）
- 目录分层（src/, lib/, packages/, modules/ 等）
- README 或文档目录

#### 第三步：深度分析
根据项目规模，选择性读取关键文件：
- README.md → 项目概述、技术栈、架构
- package.json → 依赖关系、脚本命令
- 入口文件 → 核心逻辑、模块导出
- 目录下的 index 文件 → 模块职责

用 read_file 读取关键文件（大文件只读前 100 行）。
用 grep_search 搜索核心模式（如 "export class", "interface", "router"）。

#### 第四步：生成结构化大纲

# {项目名} 知识大纲

## 📋 项目概览
- **名称**: {项目名}
- **技术栈**: {主要技术}
- **项目路径**: {磁盘路径或 URL}
- **简介**: {一句话描述}

## 🌳 项目结构
{项目名}/
├── src/
│   ├── index.ts              → 入口：HTTP 服务 + 路由注册
│   ├── chat/
│   │   ├── api-chat.ts       → 核心：LLM 流式对话处理
│   │   └── tools.ts          → 工具：10+ 工具定义与执行
│   └── storage/
│       └── index.ts          → 存储：知识库 CRUD + TF-IDF 搜索
├── web/
│   └── src/components/       → 前端 React 组件
└── package.json              → 配置：依赖与脚本

## 📚 知识文档索引
| 文档 | 用途 | 关联文件 |
|------|------|----------|
| [项目架构](kb_read://doc-id) | 整体架构设计 | src/index.ts, src/chat/ |
| [API 设计](kb_read://doc-id) | RESTful 接口规范 | src/routes/ |
| ... | ... | ... |

## 🔗 关联项目
- {关联项目1} — {关系描述}

#### 第五步：沉淀到知识库
对每个核心模块/主题，用 kb_write 沉淀独立文档：
- **必填字段**：title, content, tags, keywords, intent, project_description, project_path, related_projects, related_files
- **tags**: 包含具体技术标签 + project:{项目名}
- **content**: 结构化 Markdown（概述 → 核心逻辑 → 关键代码片段 → 注意事项）
- **related_files**: 关联的源码文件路径
- **related_projects**: 关联的其他项目名

#### 第六步：输出大纲
将大纲作为最终回答输出，大纲中的每个文档标题都是可点击的（包含文档 ID）。

#### 注意事项
- 大型项目分模块沉淀，每个模块一个文档（不要一个文档写完整个项目）
- 大纲是索引，文档是详情，两者互补
- 如果项目已有部分知识库文档，先 kb_search 查重，避免重复沉淀
- 优先沉淀核心架构和关键设计决策，不是每个文件都要沉淀

## 工具使用策略

你拥有以下工具，请根据需要主动使用：

### 信息获取
- **kb_search**: 搜索知识库中的文档（支持关键词、标签、语义搜索）
- **kb_read**: 读取知识库中的完整文档
- **kb_outline**: 查看某个项目的知识文档大纲
- **kb_list**: 列出所有知识文档

### 代码/文件分析
- **read_file**: 读取指定路径的文件内容（支持 offset/limit 分段读取）
- **grep_search**: 在文件中搜索指定模式（支持正则表达式）

### 文件系统扫描
- **scan_project**: 扫描项目目录结构，了解项目组成

### 知识沉淀
- **kb_write**: 将分析结果沉淀到知识库（必填: title, content, tags, keywords, intent, project_description, project_path, related_projects, related_files）

### 脚本执行
- **run_script**: 执行 Python/Bun 脚本（只读操作，如数据分析、文件处理）

## 工作流程

当用户询问关于某个项目/仓库的问题时：
1. 先用 kb_search 查看知识库中是否有相关文档
2. 如果没有或不够，用 scan_project 了解项目结构
3. 用 read_file 读取关键文件（README、package.json、入口文件等）
4. 用 grep_search 搜索特定代码模式
5. 必要时用 run_script 执行简单脚本辅助分析
6. 总结回答用户问题
7. 如果用户想沉淀，或内容有长期价值，主动建议用 kb_write 沉淀到知识库

## 注意事项
- 优先使用已有工具获取信息，不要编造
- 读取文件时注意文件大小，大文件只读关键部分
- 脚本执行只用于辅助分析，不做修改操作
- 沉淀文档时确保 title 简洁、tags 准确、intent 清晰

## 回答完成后
根据对话上下文，在回答末尾附上推荐话题（最多3个），格式：
[SUGGESTIONS]
1. 推荐问题
2. 推荐问题
3. 推荐问题
[/SUGGESTIONS]

建议策略（选择最相关的类型）：
- 深入型：对当前回答中的某个要点进一步追问（如"详细解释XXX的原理"）
- 关联型：查看知识库中的相关文档或项目（如"查看XXX相关的沉淀文档"）
- 行动型：建议执行某个操作（如"把这些发现沉淀到知识库"）
- 对比型：与其他方案/技术做对比分析
- 拓展型：探索当前主题的延伸方向

规则：
- 只在与用户问题高度相关时才推荐，不要每次都推荐
- 建议必须具体、可操作，不要泛泛而谈
- 每条建议不超过30个字
- 如果当前对话已经足够完整，不需要推荐`
}

function resolveConfiguredModel(provider?: string, modelId?: string): ConfiguredModel | null {
  const configured = getConfiguredModels()
  if (provider && modelId) {
    const found = configured.find(m => m.provider === provider && m.id === modelId)
    if (found) return found
  }
  // Smart fallback: prefer glm-4.5-air (free tier)
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

interface ChatMessage {
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
  body.stream_options = { include_usage: true }

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
}

interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

async function* streamResponse(resp: Response): AsyncGenerator<{ type: string; delta?: string; toolCalls?: unknown; finishReason?: string; error?: string; usage?: TokenUsage }> {
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

function sanitizeChatMessages(messages: ChatMessage[]): void {
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

function parseToolCallArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args)
  } catch {
    return {}
  }
}

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
      { role: "system", content: buildSystemPrompt() },
      ...restoreChatContext(messages),
    ]

    let assistantContent = ""
    const MAX_TOOL_ROUNDS = 10
    let totalUsage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      sanitizeChatMessages(chatMessages)
      const resp = await callOpenAI(cfg.baseUrl, cfg.apiKey, cfg.id, chatMessages, toolDefinitions, true)

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

function restoreChatContext(messages: { role: string; content: string; name?: string; args?: string; round?: number; timestamp: number; model?: string }[]): ChatMessage[] {
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

async function readBodyJson(req: IncomingMessage, maxBytes = 10 * 1024 * 1024): Promise<unknown> {
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
