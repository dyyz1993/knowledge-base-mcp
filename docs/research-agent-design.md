# Agent Research 系统设计

## 核心理念

**有预算的多步 Agent**：每一步都由 LLM 决策，但有步数上限和超时保护。
大小模型分工：小模型做快速决策，大模型做深度推理。

---

## 研究模式（ResearchMode）

| 模式 | Step 预算 | 适用场景 | 典型流程 |
|---|---|---|---|
| `quick` | 5 步 | 快速问答、概念查询 | query分析 → 搜索 → 小模型筛选 → 总结 |
| `standard` | 12 步 | 技术调研、对比分析 | query分析 → 多query搜索 → 筛选 → 深读 → sitemap判断 → 总结 |
| `deep` | 25 步 | 文档深挖、代码分析、Wiki 生成 | 全流程 + GitHub clone + 代码检索 + Wiki 生成 |

用户可在前端选择模式，默认 `standard`。

---

## Step 类型与成本

| Step | 名称 | 模型 | 成本 | 说明 |
|---|---|---|---|---|
| 1 | `analyze_query` | 小 | 1 | 分析 query → 提取核心词 + 生成子 query |
| 2 | `search` | 无 | 1 | 多 query 并行搜索（纯 IO） |
| 3 | `filter_results` | 小 | 1 | 快速过滤不相关结果 |
| 4 | `evaluate` | 大 | 2 | 评估结果质量 + 决定深读目标 + 初步大纲 |
| 5 | `deep_read` | 无 | 1 | 深读选中 URL（纯 IO） |
| 6 | `check_sitemap` | 小 | 1 | 检查文档站 sitemap/子路径 |
| 7 | `follow_paths` | 无 | 1 | 读取 sitemap 中的高关联路径（纯 IO） |
| 8 | `evaluate_depth` | 大 | 2 | 自我评分：还需深挖吗？+ 内容质量评估 |
| 9 | `check_github` | 小 | 1 | 检查是否有 GitHub repo 可以分析 |
| 10 | `clone_and_index` | 无 | 2 | clone repo + 建索引（纯 IO） |
| 11 | `code_search` | 小 | 1 | 在 repo 代码中搜索相关内容 |
| 12 | `synthesize` | 大 | 3 | 最终结构化总结/Wiki 生成 |

---

## Agent 循环流程

```
用户输入 query + mode
       ↓
┌─────────────────────────────┐
│  Step 1: analyze_query (小) │  成本:1  累计:1
│  输出: 核心词 + 3~5个子query │
│  + 研究类型判断(doc/api/code)│
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────┐
│  Step 2: search (IO)        │  成本:1  累计:2
│  多 query 并行搜索           │
│  汇总去重 → ~30条结果        │
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────┐
│  Step 3: filter_results (小)│  成本:1  累计:3
│  快速打分：保留 15~20 条      │
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────┐
│  Step 4: evaluate (大)      │  成本:2  累计:5
│  挑 5~8 条深读 + 初步大纲    │
│  + 输出 sitemap/GitHub 猜测 │
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────┐
│  Step 5: deep_read (IO)     │  成本:1  累计:6
│  并行深读 5~8 个 URL         │
└──────────┬──────────────────┘
           ↓
┌─────────────────────────────┐
│  Step 6: evaluate_depth (大)│  成本:2  累计:8
│  自我评分: 还需要更多步骤吗？ │
│  - 内容质量评分 0~10         │
│  - 覆盖度评分 0~10           │
│  - 决策: done / need_sitemap │
│           / need_github      │
│           / need_more_search │
└──────────┬──────────────────┘
           ↓
      [决策分支]
     ┌────┼────┐
     ↓    ↓    ↓
  done  sitemap github
     ↓    ↓    ↓
  总结  Step7  Step9
     ↓    ↓    ↓
        再评估...
           ↓
┌─────────────────────────────┐
│  Step N: synthesize (大)    │
│  全量上下文 → 结构化总结      │
│  带 [1][2] 引用标注          │
└─────────────────────────────┘
```

---

## Step 预算管理器

```typescript
interface StepBudget {
  mode: "quick" | "standard" | "deep"
  maxSteps: number        // 5 / 12 / 25
  maxCost: number         // 8 / 20 / 40
  usedSteps: number
  usedCost: number
  warningThreshold: 0.7   // 70% 时提醒
  criticalThreshold: 0.9  // 90% 时强制收尾
}

class BudgetManager {
  canAfford(cost: number): boolean
  shouldWarn(): boolean       // ≥70% 时返回 true
  isCritical(): boolean       // ≥90% 时返回 true
  spend(cost: number): void
  remaining(): { steps: number, cost: number }
}
```

### 70% 提醒机制

当 budget 达到 70% 时，在后续 LLM 调用的 system prompt 中注入：
```
⚠️ 你已完成 70% 的研究预算（已用 8/12 步）。请开始收尾和总结。
如果当前内容已足够回答问题，请进入总结阶段。
如果仍有关键信息缺失，最多再执行 2 步后必须总结。
```

### 90% 强制收尾

当 budget 达到 90% 时，强制执行 synthesize 步骤，不管当前状态。

---

## LLM 自我评分机制

每个 evaluate 步骤中，LLM 输出结构化 JSON：

```json
{
  "qualityScore": 7.5,
  "coverageScore": 6.0,
  "decision": "need_sitemap",
  "reason": "找到了 Vercel AI SDK 官方文档站，但当前只读了首页，需要深入 docs/ 路径获取 API 详情",
  "nextTargets": ["https://sdk.vercel.ai/docs/introduction", "https://sdk.vercel.ai/docs/api-reference"],
  "outline": "## AI SDK\n### 1. 概述\n### 2. 核心概念\n### 3. API 参考\n..."
}
```

评分标准：
- `qualityScore ≥ 8` 且 `coverageScore ≥ 7` → 可以进入总结
- `qualityScore < 5` → 需要换搜索策略（不同 query）
- `coverageScore < 6` → 需要深挖（sitemap / GitHub / 更多 URL）

---

## Sitemap 发现策略

### Step 6: check_sitemap (小模型)

输入：已读取的页面内容 + URL
小模型判断：
1. 这是不是文档站？（检查 URL pattern：`/docs/`, `/guide/`, `/api/`）
2. 页面中是否有导航链接、侧边栏目录？
3. 是否有 `/sitemap.xml`？

输出：
```json
{
  "isDocSite": true,
  "sitemapUrl": "https://sdk.vercel.ai/sitemap.xml",
  "relevantPaths": [
    "/docs/introduction",
    "/docs/api-reference/generate-text",
    "/docs/api-reference/stream-text"
  ],
  "priority": ["generate-text", "stream-text", "tools"]
}
```

### Step 7: follow_paths (IO)

读取 sitemap 中的高关联路径，每个路径的内容存入上下文池。

---

## GitHub 仓库分析

### Step 9: check_github (小模型)

输入：搜索结果中是否有 GitHub repo URL
小模型判断：
1. repo 是否相关？
2. 是否需要 clone 分析？还是 README 就够了？

输出：
```json
{
  "repoUrl": "https://github.com/vercel/ai",
  "needsClone": true,
  "targetPaths": ["README.md", "packages/ai/core/"],
  "searchKeywords": ["generateText", "streamText", "ToolLoopAgent"]
}
```

### Step 10: clone_and_index (IO)

1. `git clone --depth=1` 到临时目录
2. 读取 targetPaths 下的文件
3. 用 grep/ripgrep 搜索关键词
4. 返回相关文件列表 + 内容片段

---

## 大小模型选择策略

```typescript
interface ModelTier {
  small: LlmConfig  // 用于 Step 1,3,6,9,11（快速决策）
  large: LlmConfig  // 用于 Step 4,8,12（深度推理）
}

// 自动推断规则：
// - provider 含 "zhipuai" 且 id 含 "flash|air" → 小模型
// - provider 含 "openai" 且 id 含 "mini|nano" → 小模型
// - provider 含 "anthropic" 且 id 含 "haiku" → 小模型
// - 其余默认为大模型
// - 用户可在 Settings 中手动配置大小模型
```

---

## 实时进度推送

前端需要展示每一步的进度，使用 SSE (Server-Sent Events)：

```
event: step
data: {"step":"analyze_query","status":"running","budget":{"used":1,"max":12}}

event: step
data: {"step":"analyze_query","status":"done","output":{"keywords":["MCP","Model Context Protocol"],"subQueries":["MCP协议原理","MCP Anthropic 实现"]}}

event: step
data: {"step":"search","status":"running","budget":{"used":2,"max":12}}

...

event: done
data: {"summary":"...","sources":[...],"outline":"..."}
```

---

## 前端 UI 设计

```
┌─────────────────────────────────────────┐
│ 🔬 深度研究 · standard 模式              │
│ ━━━━━━━━━━━━━━░░░░░ 58% (7/12 步)      │
├─────────────────────────────────────────┤
│ ✅ 分析查询 → MCP协议 + 3个子query       │
│ ✅ 搜索 → 26 条结果                      │
│ ✅ 初筛 → 保留 18 条                     │
│ ✅ 评估 → 挑选 6 条深读                  │
│ ✅ 深读 → 5/6 成功                       │
│ ✅ 质量评估 → 7.5/10 (需要更多文档)       │
│ 🔄 正在检查 sitemap...                   │
│ ⏳ 等待：读取文档子路径                   │
│ ⏳ 等待：最终总结                         │
├─────────────────────────────────────────┤
│ 📋 初步大纲                              │
│ ## MCP 协议                              │
│ ### 1. 什么是 MCP                        │
│ ### 2. 核心架构                          │
│ ### 3. 实战示例                          │
├─────────────────────────────────────────┤
│ [暂停] [切换到快速模式] [立即总结]        │
└─────────────────────────────────────────┘
```

---

## 文件结构

```
src/
  research/                          # Agent Research 模块
    types.ts                         # ResearchMode, StepBudget, ResearchStep, etc.
    budget-manager.ts                # Step 预算管理
    model-tier.ts                    # 大小模型选择 + 自动推断
    research-agent.ts                # 主 Agent 编排器（循环）
    steps/
      analyze-query.ts               # Step 1: query 分析 (小模型)
      search.ts                      # Step 2: 多 query 搜索
      filter-results.ts              # Step 3: 结果初筛 (小模型)
      evaluate.ts                    # Step 4: 深度评估 (大模型)
      deep-read.ts                   # Step 5: 深读 URL
      check-sitemap.ts               # Step 6: sitemap 检查 (小模型)
      follow-paths.ts                # Step 7: 跟进路径
      evaluate-depth.ts              # Step 8: 自我评分 (大模型)
      check-github.ts                # Step 9: GitHub 检查 (小模型)
      clone-index.ts                 # Step 10: clone + 索引
      code-search.ts                 # Step 11: 代码搜索 (小模型)
      synthesize.ts                  # Step 12: 最终总结 (大模型)
    index.ts                         # 公共 API

  index.ts                           # /api/agent-research SSE 端点
```

---

## API 端点

### POST /api/agent-research

**请求：**
```json
{
  "query": "如何使用 AI SDK",
  "mode": "standard",
  "model": { "provider": "zhipuai", "id": "glm-4.5" },
  "smallModel": { "provider": "zhipuai", "id": "glm-4-flash" }
}
```

**响应：** SSE 流

每一步推送进度，最后推送最终结果。

### GET /api/agent-research/:id/status

查询正在进行的任务的当前状态（用于断线重连）。

---

## 实施优先级

### P0 — 核心循环（v2.27.0）
1. BudgetManager
2. ModelTier (大小模型选择)
3. ResearchAgent 主循环
4. Step 1: analyze-query
5. Step 2: search (复用现有 SearchPipeline)
6. Step 3: filter-results
7. Step 4: evaluate
8. Step 5: deep-read (复用现有深读逻辑)
9. Step 8: evaluate-depth (自我评分)
10. Step 12: synthesize
11. /api/agent-research SSE 端点
12. 前端进度 UI

### P1 — Sitemap 深挖（v2.28.0）
13. Step 6: check-sitemap
14. Step 7: follow-paths

### P2 — GitHub 分析（v2.29.0）
15. Step 9: check-github
16. Step 10: clone-index
17. Step 11: code-search

### P3 — 增强（v2.30.0）
18. 用户反馈 + 结果评分
19. 历史研究记录
20. Wiki 导出
