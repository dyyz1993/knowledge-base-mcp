# Ask 研究助手 — 智能搜索聚合与知识沉淀

> **Goal:** 将 Ask Tab 从"简单 KB 搜索"升级为"AI 研究助手"，支持多源搜索聚合、质量评分、深度爬取、知识沉淀。

**Architecture:** Ask 流程由 LLM 驱动，采用 Pipeline 模式：意图分析 → 多源并行搜索 → 结果聚合评分 → 深度爬取 → 知识沉淀。所有搜索来源可配置、可插拔，用户在 Settings 中控制启用哪些源和优先级。

**Tech Stack:** Bun + TypeScript, MCP Client (智谱), xbrowser CLI, OpenAI-compatible LLM API, Zustand + React (前端)

---

## 整体流程

```
用户输入问题
    ↓
Phase 1: 意图分析（LLM 判断）
    - 是知识查询？技术问题？还是通用搜索？
    - 有没有明确的官方来源？（如 "React hooks" → react.dev）
    ↓
Phase 2: 多源并行搜索（Parallel）
    ├─ web-search-prime（智谱 MCP，快速结构化结果）
    ├─ xbrowser search（可配搜索引擎，有浏览器能力）
    ├─ LLM 直接回答（豆包/智谱等，利用内置知识）
    └─ url_fetch（已知 URL 直接抓取）
    ↓
Phase 3: 聚合 + 评分
    - 来源可信度：官网 > 官方文档 > 知名平台 > 个人博客
    - 内容相关度：与查询意图的匹配程度
    - 新鲜度：内容时效性
    - 去重合并：多源相同信息合并
    ↓
Phase 4: 展示结果卡片
    - 每条结果带：来源标签、可信度评分、摘要
    - 用户可选择：查看详情 / 深度爬取 / 直接存入 KB
    ↓
Phase 5: 深度爬取（用户触发）
    - xbrowser scrape（支持 CDP → 用登录态浏览器）
    - xbrowser map（发现站点全部 URL）
    - xbrowser crawl（多页爬取）
    - git_clone（代码仓库下载解读）
    ↓
Phase 6: 知识沉淀
    - LLM 总结整理
    - 存入 KB（带来源标签、质量评分、来源 URL）
    - 形成 Work Key（结构化大纲 + 关键信息）
    - 下次直接命中，无需再搜
```

---

## 配置设计

### Settings 新增区块：搜索配置

```typescript
interface SearchPipelineConfig {
  enabled: boolean                    // 总开关
  sources: {
    webSearchPrime: {
      enabled: boolean
      apiKey: string                  // 智谱 API Key
    }
    xbrowser: {
      enabled: boolean
      engine: "google" | "bing" | "baidu"  // 搜索引擎
      cdpEndpoint: string            // CDP 地址（可用家庭浏览器）
    }
    llmDirect: {
      enabled: boolean
      provider: string               // 豆包/智谱/其他
      apiKey: string
      model: string
    }
  }
  quality: {
    preferOfficial: boolean           // 优先官网
    minScore: number                  // 最低质量分
  }
}
```

---

## 任务分解

### Task 1: 搜索管道后端 — SearchPipeline 模块

**Files:**
- Create: `src/search/search-pipeline.ts`
- Create: `src/search/source-web-search-prime.ts`
- Create: `src/search/source-xbrowser.ts`
- Create: `src/search/source-llm-direct.ts`
- Create: `src/search/source-url-fetch.ts`
- Create: `src/search/result-aggregator.ts`

**核心接口设计：**

```typescript
// src/search/search-pipeline.ts

interface SearchResult {
  title: string
  url: string
  snippet: string
  source: "web-search-prime" | "xbrowser" | "llm-direct" | "url-fetch"
  sourceType: "official" | "documentation" | "platform" | "blog" | "llm-knowledge"
  qualityScore: number              // 0-100
  rawContent?: string
}

interface SearchSource {
  name: string
  search(query: string): Promise<SearchResult[]>
  available(): boolean              // 检查配置是否可用
}

interface PipelineConfig {
  sources: SearchSource[]
  maxParallel: number               // 最大并行数
  preferOfficial: boolean
}

class SearchPipeline {
  constructor(config: PipelineConfig) {}

  async search(query: string): Promise<AggregatedResult> {
    // 1. 并行调用所有可用 source
    // 2. 聚合结果
    // 3. 评分排序
    // 4. 返回
  }
}
```

**Step 1:** 创建接口文件 `search-pipeline.ts`，定义 SearchResult、SearchSource 接口

**Step 2:** 实现 `source-web-search-prime.ts` — 包装现有 `McpWebSearch`

**Step 3:** 实现 `source-xbrowser.ts` — 通过 `Bun.spawn` 调用 xbrowser CLI

```typescript
// xbrowser search "query" --engine google --limit 5
// xbrowser scrape "url" --format markdown
// xbrowser map "url"
// xbrowser crawl "url" --limit 10
```

**Step 4:** 实现 `source-llm-direct.ts` — 调 OpenAI-compatible API

```typescript
// POST {baseUrl}/chat/completions
// system: "你是一个知识助手，请简洁准确地回答以下问题"
// 返回 LLM 的回答作为 search result（sourceType: "llm-knowledge"）
```

**Step 5:** 实现 `source-url-fetch.ts` — 包装现有 curl 方式

**Step 6:** 实现 `result-aggregator.ts` — 去重、评分、排序

```typescript
// 评分规则：
// - URL 包含官方域名 → +30 分（react.dev, nodejs.org 等）
// - sourceType == official → +20
// - sourceType == documentation → +15
// - 来源是知名平台（知乎、掘金、StackOverflow）→ +10
// - snippet 与 query 语义相关 → +0~20
// - 多源出现相同信息 → 叠加 +5/次
```

**Step 7:** 组装 `SearchPipeline` 主类，串起 source → parallel → aggregate

**Step 8:** 单元测试 `result-aggregator.test.ts`

---

### Task 2: 后端 API — 新增搜索端点

**Files:**
- Modify: `src/index.ts`

**Step 1:** `POST /api/ask-search` — 触发搜索管道

```typescript
// Request: { query: string }
// Response: {
//   results: SearchResult[],        // 聚合后的搜索结果
//   total_sources: number,          // 搜索了多少个源
//   duration_ms: number,
//   hint: string
// }
```

**Step 2:** `POST /api/ask-deep-read` — 深度爬取指定 URL

```typescript
// Request: { url: string, method: "scrape" | "map" | "crawl", depth?: number }
// Response: { content: string, urls?: string[], title: string }
// 内部根据配置选择 xbrowser（有 CDP 支持）或 url_fetch
```

**Step 3:** `POST /api/ask-summarize` — LLM 总结内容

```typescript
// Request: { content: string, query: string }
// Response: { summary: string, keywords: string[], keyPoints: string[] }
// 用配置的 LLM 做总结，生成结构化大纲
```

**Step 4:** 修改 `POST /api/kb-ask` — miss 时调用 SearchPipeline 替代现有逻辑

**Step 5:** 修改 `POST /api/kb-ingest` — 增加质量评分和来源类型字段

---

### Task 3: 配置扩展 — Settings 后端 + 前端

**Files:**
- Modify: `src/config.ts` — 扩展 config 结构
- Modify: `web/src/services/api.ts` — 新增类型定义
- Modify: `web/src/components/SettingsPanel.tsx` — 搜索配置 UI

**Step 1:** 扩展 `config.ts` 的 AppConfig

```typescript
searchPipeline: {
  enabled: boolean
  sources: {
    webSearchPrime: { enabled: boolean; apiKey: string }
    xbrowser: { enabled: boolean; engine: "google" | "bing" | "baidu"; cdpEndpoint: string }
    llmDirect: { enabled: boolean; provider: string; apiKey: string; model: string }
  }
  quality: { preferOfficial: boolean; minScore: number }
}
```

**Step 2:** 更新 `api.ts` 的 AppConfig interface

**Step 3:** Settings 面板新增"搜索管道"区块

UI 布局：
```
✨ 搜索管道（Ask 研究助手）
├─ [总开关] 启用多源搜索
├─ 搜索来源
│  ├─ ☑ Web Search Prime（智谱）   [API Key: ****]
│  ├─ ☑ xbrowser                   [引擎: Google ▼] [CDP: ws://...]
│  └─ ☑ LLM 直接回答               [模型: 豆包/智谱 ▼] [API Key: ****]
├─ 质量控制
│  ├─ [✓] 优先官方来源
│  └─ 最低质量分: [Slider 0-100]
```

**Step 4:** 更新 `/api/config` GET/PUT 处理 searchPipeline 字段

---

### Task 4: 前端 AskPanel 升级 — 搜索结果展示

**Files:**
- Modify: `web/src/stores/ask.ts` — 新增 search/summarize actions
- Modify: `web/src/components/AskPanel.tsx` — 搜索结果卡片 + 深度爬取 UI
- Create: `web/src/components/AskSearchResult.tsx` — 搜索结果卡片组件

**Step 1:** 更新 askStore — 新增 actions

```typescript
askStore 新增:
  searchResults: SearchResult[]
  deepReading: boolean
  search: (query: string) => Promise<void>     // 调 /api/ask-search
  deepRead: (url: string, method: string) => Promise<void>  // 调 /api/ask-deep-read
  summarize: (content: string, query: string) => Promise<void>  // 调 /api/ask-summarize
```

**Step 2:** 搜索结果卡片组件 `AskSearchResult.tsx`

每条结果展示：
- 来源标签（带颜色区分）
- 质量评分（星级或数字）
- 标题 + 摘要
- 操作按钮：[读取详情] [深度爬取] [Map 站点] [存入 KB]

**Step 3:** 深度爬取 UI

点击"深度爬取"后：
- 弹出选项：scrape（单页）/ map（站点地图）/ crawl（多页爬取）
- 可选 CDP 浏览器（用登录态）
- 进度展示
- 结果预览

**Step 4:** 聚合结果顶部摘要

```
🔍 搜索完成（3 个来源，耗时 2.3s）
├─ Web Search Prime: 5 条结果
├─ xbrowser: 3 条结果  
└─ LLM 直接回答: 1 条

综合评分最高的来源：
1. ⭐92 [官方] React Official Docs - generateText
2. ⭐78 [文档] AI SDK Core: Generating Text
3. ⭐65 [平台] 知乎 - AI SDK 使用指南
```

---

### Task 5: xbrowser CLI 集成

**Files:**
- Create: `src/search/xbrowser-cli.ts`

**Step 1:** 实现 xbrowser CLI 封装

```typescript
class XBrowserCLI {
  private cdpEndpoint?: string

  constructor(config: { cdpEndpoint?: string }) {}

  async search(query: string, engine = "google", limit = 5): Promise<SearchResult[]>
  // Bun.spawn: xbrowser search "query" --engine google --limit 5 --json

  async scrape(url: string, format = "markdown"): Promise<string>
  // Bun.spawn: xbrowser scrape "url" --format markdown
  // 如果有 CDP: xbrowser scrape "url" --cdp ws://...

  async map(url: string): Promise<string[]>
  // Bun.spawn: xbrowser map "url" --json

  async crawl(url: string, limit = 10): Promise<{ url: string; content: string }[]>
  // Bun.spawn: xbrowser crawl "url" --limit 10 --json
}
```

**Step 2:** 解析 xbrowser 输出格式（JSON/text）

**Step 3:** 错误处理 — xbrowser 不可用时的 fallback

**Step 4:** CDP 支持 — 传递 `--cdp` 参数连接远程浏览器

---

### Task 6: LLM 直接回答集成

**Files:**
- Create: `src/search/llm-direct.ts`

**Step 1:** 实现 LLM 直接回答源

```typescript
class LlmDirectSource implements SearchSource {
  async search(query: string): Promise<SearchResult[]> {
    // 1. 调用 OpenAI-compatible API
    // 2. System prompt: "简洁回答，标注信息来源"
    // 3. 返回结构化结果（sourceType: "llm-knowledge"）
  }
}
```

**Step 2:** 支持多个 LLM provider（豆包/智谱/其他 OpenAI-compatible）

**Step 3:** 结果标记 — LLM 回答标注为 "LLM 知识" 而非 "搜索结果"

---

### Task 7: 质量评分与来源识别

**Files:**
- Create: `src/search/quality-scorer.ts`
- Create: `src/search/source-identifier.ts`

**Step 1:** 实现来源识别

```typescript
// 根据 URL 识别来源类型
// react.dev, vuejs.org, nodejs.org → "official"
// docs.xxx.com, developer.xxx.com → "documentation"
// zhihu.com, juejin.cn, stackoverflow.com → "platform"
// github.com → "repository"
// 其他 → "blog" | "unknown"

// 已知官方域名白名单（可扩展）:
const OFFICIAL_DOMAINS = [
  "react.dev", "vuejs.org", "angular.io", "nodejs.org",
  "python.org", "go.dev", "rust-lang.org", "ruby-lang.org",
  "docs.python.org", "developer.mozilla.org",
  "ai-sdk.dev", "sdk.vercel.ai",
  "typescriptlang.org", "javascript.info",
  // ... 更多
]
```

**Step 2:** 实现质量评分

```typescript
function scoreResult(result: SearchResult, query: string, crossSourceCount: number): number {
  let score = 50 // 基础分

  // 来源类型加分
  if (result.sourceType === "official") score += 30
  else if (result.sourceType === "documentation") score += 20
  else if (result.sourceType === "platform") score += 10
  else if (result.sourceType === "repository") score += 15

  // 多源交叉验证加分
  score += Math.min(crossSourceCount * 5, 20)

  // 内容相关度（简单的关键词匹配，后续可升级为语义匹配）
  // ...

  return Math.min(score, 100)
}
```

---

### Task 8: 知识沉淀 — Work Key 生成

**Files:**
- Create: `src/search/work-key-builder.ts`

**Step 1:** 实现 Work Key 结构

```typescript
interface WorkKey {
  id: string
  query: string                       // 原始查询
  summary: string                     // LLM 总结
  keyPoints: string[]                 // 关键要点
  sources: {
    url: string
    title: string
    qualityScore: number
    sourceType: string
  }[]
  outline: string                     // 结构化大纲（Markdown）
  keywords: string[]                  // 提取的关键词
  tags: string[]                      // 自动标签
  createdAt: number
}
```

**Step 2:** 深度爬取后自动生成 Work Key

流程：多源搜索 → 用户选某个来源深度爬取 → LLM 总结 → 生成 Work Key → 存入 KB

**Step 3:** `/api/kb-ingest` 扩展 — 支持 Work Key 格式存储

---

### Task 9: MCP 可关闭 + 启动参数优化

**Files:**
- Modify: `src/index.ts` — 新增 `--no-mcp` 参数

**Step 1:** 新增 `--no-mcp` 启动参数

当指定 `--no-mcp` 时：
- 不注册 MCP tools
- 不启动 MCP transport（StreamableHTTP/SSE）
- 只保留 HTTP REST API + Web UI
- 适合纯 Web UI 用户

**Step 2:** 帮助信息更新

```
Usage: kb-mcp [options]
  --http          HTTP 模式（API + Web UI）
  --web           启用 Web UI 静态文件服务
  --port <N>      端口号（默认 19877）
  --no-mcp        禁用 MCP 协议（只保留 REST API）
  --stdio         Stdio MCP 模式（Agent 调用）
```

---

### Task 10: 移动端适配优化

**Files:**
- Modify: `web/src/components/AskPanel.tsx` — 响应式布局优化
- Modify: `web/src/components/SettingsPanel.tsx` — 移动端友好

**Step 1:** AskPanel 搜索结果卡片在移动端的布局优化

- 全宽卡片
- 来源标签紧凑显示
- 操作按钮底部固定

**Step 2:** Settings 面板移动端优化

- 分区折叠/展开
- Input 组件适配小屏

---

## 执行优先级

| 优先级| 任务 | 依赖 |
|---|---|---|
| P0 | Task 1: SearchPipeline 核心模块 | 无 |
| P0 | Task 2: 后端 API 端点 | Task 1 |
| P0 | Task 3: 配置扩展 | 无 |
| P1 | Task 4: 前端 AskPanel 升级 | Task 2, 3 |
| P1 | Task 5: xbrowser CLI 集成 | Task 1 |
| P1 | Task 6: LLM 直接回答 | Task 1 |
| P1 | Task 7: 质量评分 | Task 1 |
| P2 | Task 8: Work Key 生成 | Task 4, 7 |
| P2 | Task 9: MCP 可关闭 | 无 |
| P2 | Task 10: 移动端适配 | Task 4 |

## 版本规划

- **v2.23.0**: Task 1 + 2 + 3（后端管道 + API + 配置）
- **v2.24.0**: Task 4 + 5 + 6（前端升级 + xbrowser + LLM）
- **v2.25.0**: Task 7 + 8 + 9 + 10（评分 + Work Key + MCP 可关 + 移动端）
