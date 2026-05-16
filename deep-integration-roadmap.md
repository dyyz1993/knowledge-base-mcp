# KB-MCP 深度集成架构：Reader + Search + AI 管道

## 现状：你有但不在一起

你提到的这些能力，项目**已经具备依赖**：

```
package.json 已有：
├── @dyyz1993/pi-ai        → AI 处理（摘要/分类/打分）
├── @dyyz1993/xbrowser      → 浏览器自动化
├── playwright              → 浏览器引擎
└── turndown-plugin-gfm     → HTML → Markdown
```

但它们是「散装」的——agent 能调用，KB-MCP 服务本身没有串起来。

## 核心思路：KB-MCP 变成一个「自带工具的工人」

```
请求进来
  │
  ├─ kb_ask("如何修复 X")
  │    ├─ 先搜 KB → 命中直接返回（秒级）
  │    │
  │    └─ 没命中 → 启动管道：
  │         ├─ web-search-prime  ──→ 找到相关页面
  │         ├─ web-reader        ──→ 抓取页面内容
  │         ├─ agent-browser     ──→ 复杂页面/需要交互
  │         ├─ zread             ──→ GitHub 仓库源码
  │         ├─ pi-ai 摘要        ──→ 提炼核心
  │         ├─ 去重 + 质量评分   ──→ 是否值得存
  │         └─ kb_write          ──→ 沉淀到知识库 ✅
  │
  └─ 返回结果给用户
```

---

## 集成方案

### 1. web-reader → `reader_url` 工具

抓取 URL 内容并转为结构化 Markdown。

```
依赖：turndown-plugin-gfm（已有）
      xbrowser（已有，处理 JS 渲染页面）

工具：reader_url(url: string, use_browser?: boolean)
功能：抓取 → 转 Markdown → 提取标题/正文 → 返回
```

### 2. web-search-prime → `reader_search` 工具

内置搜索能力，找到相关内容。

```
方案 A：集成搜索 API（Google/Bing/SerpAPI）
方案 B：用 xbrowser 做浏览器搜索（零 API 成本）

工具：reader_search(query: string, max_results?: number)
功能：搜索 → 提取链接/标题/摘要 → 返回列表
```

### 3. zread → `reader_github` 工具

读取 GitHub 仓库的目录结构和文件内容。

```
工具：reader_github(repo: string, path?: string)
      reader_github_file(repo: string, file_path: string)
功能：读取仓库结构 → 读取文件内容 → 分析代码
```

### 4. agent-browser + 爬虫 CLI

你已经装好了 `@dyyz1993/xbrowser` + `playwright`，可以直接用。

```
工具：reader_browser(url: string, script?: string)
      reader_scrape(url: string, selector?: string)
功能：浏览器自动化 → 提取数据 → 转为结构化内容
```

### 5. zai-mcp-server（图像/AI 分析）

图片分析、OCR、UI 截图分析，可以作为知识管道的后期处理。

```
管道集成：
  web-reader 抓取到内容后
  → zai-mcp-server 分析图片/截图
  → pi-ai 综合分析
  → kb_write 存储
```

### 6. 付费 MCP / 第三方 MCP 服务

KB-MCP 可以通过 MCP 协议调用其他 MCP 服务：

```
KB-MCP ──MCP Client──→ 付费 MCP 服务
         │               ├─ 某 AI 服务
         │               ├─ 某搜索服务
         │               └─ 某数据处理服务
         │
         └──MCP Server──→ agent（OpenCode 等客户端）
```

---

## 实际实现路线图

### Phase 1：Reader 集成（本周）

| 工具 | 状态 | 依赖 |
|------|------|------|
| `file_read` | ✅ 已发布 | fs |
| `file_grep` | ✅ 已发布 | fs |
| `reader_url` | ◻ 待实现 | turndown + xbrowser |
| `reader_search` | ◻ 待实现 | web search API / xbrowser |

### Phase 2：AI 管道（2 周）

| 组件 | 用途 | 技术选型 |
|------|------|----------|
| 内容摘要 | 长文提炼 | pi-ai |
| 质量评分 | 判断是否值得存 | pi-ai + 规则 |
| 自动标签 | 分类 | pi-ai |
| 实体提取 | 提取关键词/技术名 | pi-ai |

### Phase 3：自动化（1 月）

| 机制 | 说明 |
|------|------|
| `kb_ask` | 智能查询：KB → 外部 → 存储 |
| `kb_ingest_url` | 单 URL 摄入 |
| `kb_ingest_search` | 搜索→摄入 |
| stale check | 过期文件检测 |

---

## 关键优势

**这些不需要外部依赖。** 全部依赖已在 `package.json` 里：

```
@dyyz1993/pi-ai     → AI
@dyyz1993/xbrowser  → 浏览器
playwright          → 浏览器引擎
turndown-plugin-gfm → HTML 转 Markdown
```

**只需要写胶水代码把它们连成管道。** 而且你现有的三层搜索架构（P0/P1/P2）已经提供了存储和检索的基础设施。

---

## 一句话

> **这不是「再加一个新功能」，而是把 KB-MCP 从「一个文件抽屉」变成一个「有眼睛（reader）、有脑子（AI）、有手（browser）的知识工人」。**
