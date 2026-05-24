# Knowledge-Base-MCP 项目功能验证大纲

> 覆盖所有 API 端点、搜索组合、降级场景的结构化测试计划

---

## 1. 基础设施 (Infrastructure)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 1.1 | `/health` | GET | 无 | `{"status":"ok","service":"knowledge-base-mcp","version":"..."}` |
| 1.2 | `/` | GET | 无 (webDist 已构建) | 返回 index.html, 200 |
| 1.3 | `/assets/*` | GET | 静态资源路径 | 返回资源 + `Cache-Control: public, max-age=31536000, immutable` |
| 1.4 | `/nonexistent` | GET | 无 | 404 或 fallback 到 index.html (SPA) |
| 1.5 | `/../etc/passwd` | GET | 路径穿越 | 403 Forbidden (resolvedFp 检查) |
| 1.6 | `/api/share` | OPTIONS | 无 | 204 + CORS headers (`Access-Control-Allow-Origin: *`) |
| 1.7 | `/*` | OPTIONS | 自定义 | 检查 CORS headers 是否正确返回 |

---

## 2. 文档 CRUD (Document Management)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 2.1 | `/api/docs/write` | POST | `{title, content, tags?, keywords?, intent?, project_description?}` | 返回 `{id, title, tags, ...}` 201 |
| 2.2 | `/api/docs/write` | POST | `{title: ""}` (缺失 content) | 400 `title and content are required strings` |
| 2.3 | `/api/docs` | GET | 无 | 返回 `DocMeta[]` 列表 |
| 2.4 | `/api/doc/:id` | GET | path: id | 返回 `{meta, content, truncated}` |
| 2.5 | `/api/doc/:id` | GET | path: 不存在的 id | 返回 `null` |
| 2.6 | `/api/doc/:id` | DELETE | path: id | 返回 `{deleted: true/false, id}` |
| 2.7 | `/api/docs` | POST | `{id: "..."}` | 通过 id 读取文档, 返回 readDoc 结果 |
| 2.8 | `/api/docs/recent` | GET | `?hours=24&limit=50&include_content=false&format=json` | 返回近期文档列表 |
| 2.9 | `/api/docs/recent` | GET | `?format=html` | 返回 HTML 渲染的近期文档 |
| 2.10 | `/api/outlines` | GET | 无 | 返回所有项目大纲列表 |
| 2.11 | `/api/outline` | GET | `?project=/path/to/project` | 返回项目大纲 |
| 2.12 | `/api/outline` | GET | 缺失 project 参数 | 400 `project required` |
| 2.13 | `/api/docs/keywords` | GET | 无 | 返回所有关键词列表 |

---

## 3. 本地搜索 (Local Search)

### 3.1 关键词搜索 (keyword)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 3.1.1 | `/api/search` | POST | `{query: "关键词"}` | 当 `config.search.mode` 非 tfidf/semantic 时, 走 keyword search |
| 3.1.2 | `/api/search` | POST | `{query: "test", keywords: ["kw1","kw2"]}` | keyword boost 匹配 |
| 3.1.3 | `/api/search` | POST | `{query: "test", tags: ["reference"]}` | tag 过滤 |

### 3.2 语义搜索 (semantic)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 3.2.1 | `/api/search/semantic` | POST | `{query: "语义查询", limit?: 10}` | 返回带 `score` 的文档列表 |
| 3.2.2 | `/api/search/semantic` | POST | embedding 未启用 | 500 error message |
| 3.2.3 | `/api/search/semantic` | POST | `{query: ""}` (空查询) | 验证行为 (返回空或报错) |

### 3.3 混合搜索 (combined / default)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 3.3.1 | `/api/search` | POST | `{query: "混合查询", keywords: [], tags: [], limit: 10}` | searchDocsCombined: 并行 keyword + tfidf + semantic → RRF 合并 |
| 3.3.2 | `/api/search` | POST | `{query: "..."}` combined 失败 | fallback 到 keyword search |

### 3.4 TF-IDF 搜索

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 3.4.1 | `/api/search` | POST | `config.search.mode = "tfidf"` 时 | 使用 tfidfSearch 进行搜索 |

### 3.5 Embedding 相关

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 3.5.1 | `/api/embedding/test` | POST | 无 | `{success: true, dimensions: N}` 或 `{success: false, error: "..."}` |
| 3.5.2 | `/api/embedding/test` | POST | embedding 未启用 | `{success: false, error: "Embedding not enabled"}` |
| 3.5.3 | `/api/embedding/reindex` | POST | 无 | `{success: true, message: "Reindexed N documents"}` |
| 3.5.4 | `/api/embedding/reindex` | POST | 无文档 | `{success: true, message: "No documents to reindex"}` |

---

## 4. 联网搜索 (Web Search Sources)

### 4.1 搜索源列表

| 源 | 文件 | 可用条件 |
|----|------|----------|
| web-search-prime | `source-web-search-prime.ts` | MCP webSearch 工具可用 + quota 未超 |
| tavily | `source-tavily.ts` | `webSearch.tavilyApiKey` 配置 |
| serper | `source-serper.ts` | `webSearch.serperApiKey` 配置 |
| xbrowser | `source-xbrowser.ts` | `searchPipeline.sources.xbrowser.enabled` + CLI 可用 |
| ai-search | `source-ai-search.ts` | zhipu API key 配置 |
| llm-direct | `source-llm-direct.ts` | `searchPipeline.sources.llmDirect.apiKey` 配置 |

### 4.2 端到端搜索验证

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 4.2.1 | `/api/ask-search` | POST | `{query: "test query", model?: {provider, id}}` | SearchPipeline 聚合多源结果 |
| 4.2.2 | `/api/ask-search` | POST | searchPipeline 未启用 | 503 `Search pipeline not enabled` |
| 4.2.3 | `/api/ask-search` | POST | 缺失 query | 400 `Missing 'query'` |
| 4.2.4 | `/api/web-read` | POST | `{url: "https://example.com"}` | `{success: true, title, content}` |
| 4.2.5 | `/api/web-read` | POST | `{url: ""}` | 400 `Missing 'url' field` |
| 4.2.6 | `/api/web-read` | POST | `{url: "http://127.0.0.1:6379"}` (SSRF) | 400 `URL blocked: ...` |
| 4.2.7 | `/api/web-read` | POST | 内容提取失败 | 500 `Failed to extract content` |

---

## 5. Ask 管线 (Ask Pipeline)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 5.1 | `/api/kb-ask` | POST | `{query: "问题", max_web_results?: 3}` | KB 命中 → `{from_kb: true, ...}`; miss → 联网搜索 → `{from_kb: false, ...}` |
| 5.2 | `/api/kb-ask` | POST | `{query: ""}` | 400 `Missing or invalid 'query' field` |
| 5.3 | `/api/kb-ask` | POST | query 命中本地 KB | `from_kb: true` + content + quality score |
| 5.4 | `/api/kb-ask` | POST | query 未命中, 触发联网搜索 | `from_kb: false` + web results + hint |
| 5.5 | `/api/kb-ask` | POST | 管线异常 | `{from_kb: false, hint: "查询失败", error: "..."}` |

---

## 6. Research (深度研究)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 6.1 | `/api/ask-research` | POST | `{query, model?: {provider, id}}` | SSE 流: `step` → `done` (含 searchResults, summary, sources, phaseLog) |
| 6.2 | `/api/ask-research` | POST | searchPipeline 未启用 | 503 `Search pipeline not enabled` |
| 6.3 | `/api/ask-research` | POST | 缺失 query | 400 `Missing 'query'` |
| 6.4 | `/api/ask-research` | POST | 无 model 配置 | searchResults only, summary=null, evaluatedCount=0 |
| 6.5 | `/api/ask-research` | POST | 搜索 0 结果 | summary="未找到相关搜索结果" |
| 6.6 | `/api/agent-research` | POST | `{query, mode: "standard"\|"deep"\|"quick", model?, smallModel?}` | SSE 流: `step` 事件 → `done` 事件 |
| 6.7 | `/api/agent-research` | POST | searchPipeline 未启用 | 503 |
| 6.8 | `/api/research-evolve` | POST | `{maxCycles?: 3, model?, smallModel?, targetMetrics?}` | SSE 流: `log` 事件 → `done` 事件 |
| 6.9 | `/api/ask-deep-read` | POST | `{url: "https://example.com"}` | xbrowser → MCP readUrl → fetch 降级链 |
| 6.10 | `/api/ask-deep-read` | POST | SSRF URL | 400 `URL blocked` |
| 6.11 | `/api/ask-deep-read` | POST | 所有读取源不可用 | 503 `No deep read source available` |
| 6.12 | `/api/ask-summarize` | POST | `{query?, content, title, url?, tags?, keywords?}` | 保存文档 + resolveMiss |
| 6.13 | `/api/ask-summarize` | POST | 缺失 content/title | 400 |
| 6.14 | `/api/ask-work-key` | POST | `{query, results: [{title,snippet,url,sourceType,qualityScore,source}], model?}` | LLM 生成研究报告 → 保存文档 |
| 6.15 | `/api/ask-work-key` | POST | 缺失 query/results | 400 |
| 6.16 | `/api/ingest-site` | POST | `{url, tags?, projectName?, maxPages?, concurrency?}` | SSE 流: `progress` → `done` |
| 6.17 | `/api/ingest-site` | POST | 缺失 url | 400 |
| 6.18 | `/api/kb-ingest` | POST | `{url?, title, content, tags?, keywords?}` | `{saved: true, id, miss_resolved: true}` |
| 6.19 | `/api/kb-ingest` | POST | 缺失 title/content | 400 |

---

## 7. Chat (对话系统)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 7.1 | `/api/chat` | POST | `{message: "hello", sessionId?: "..."}` | SSE 流: `delta`/`tool_calls_delta` → `done`/`error` |
| 7.2 | `/api/chat` | POST | 无可用 model | SSE `error`: `No model available` |
| 7.3 | `/api/chat` | POST | model 缺失 apiKey | SSE `error`: `missing apiKey or baseUrl` |
| 7.4 | `/api/chat` | POST | 触发 tool call (如 kb_search) | SSE `tool_calls_delta` → tool 执行结果 → 继续生成 |
| 7.5 | `/api/chat` | POST | 超过 MAX_TOOL_ROUNDS (10) | 截断并返回 |
| 7.6 | `/api/models` | GET | 无 | 返回已配置模型列表 `[{provider, id, hasApiKey, hasBaseUrl}]` |
| 7.7 | `/api/models` | PUT | `{provider: "zhipuai", id: "glm-4-flash"}` | `{success: true}` |
| 7.8 | `/api/sessions` | GET | 无 | 返回会话列表 |
| 7.9 | `/api/sessions` | POST | `{title?: "..."}` | 创建新会话, 返回 `{id, title, ...}` |
| 7.10 | `/api/sessions/:id/rename` | PUT | `{title: "new name"}` | `{success: true}` |
| 7.11 | `/api/sessions/:id/messages` | GET | 无 | 返回消息历史 |
| 7.12 | `/api/sessions/:id` | DELETE | 无 | 删除会话 |
| 7.13 | `/api/favorites` | GET | 无 | 返回收藏列表 |
| 7.14 | `/api/favorites` | POST | `{docId, note?}` | 添加收藏 |
| 7.15 | `/api/favorites/:id` | DELETE | 无 | 删除收藏 |
| 7.16 | `/api/session-favorites` | GET | 无 | 返回会话收藏列表 |
| 7.17 | `/api/session-favorites` | POST | `{sessionId, messageId, note?}` | 添加会话收藏 |
| 7.18 | `/api/session-favorites/:id` | DELETE | 无 | 删除会话收藏 |
| 7.19 | `/api/share/:sessionId` | GET | 无 | 返回分享数据 |
| 7.20 | `/api/browser/detect` | GET | 无 | 返回浏览器检测结果 |
| 7.21 | `/api/skills/scan` | POST | 无 | 扫描并返回 skills 列表 |
| 7.22 | `/api/skills/paths` | GET | 无 | 返回 skill 路径配置 |
| 7.23 | `/api/skills/paths` | PUT | `{paths: ["~/.agents/skills"]}` | 更新 skill 路径 |

### Chat 工具调用 (Tool Calls)

| 工具名 | 功能 | 验证点 |
|--------|------|--------|
| `kb_search` | 搜索知识库 | 返回搜索结果 |
| `kb_read` | 读取文档 | 返回文档内容 |
| `kb_list` | 列出文档 | 返回文档列表 |
| `kb_write` | 写入文档 | 写入并返回 ID |
| `kb_outline` | 获取大纲 | 返回项目大纲 |
| `scan_project` | 扫描项目 | 返回项目结构 |
| `browser_scrape` | 浏览器抓取 | 返回页面内容 |
| `browser_map` | 站点地图 | 返回 URL 列表 |
| `browser_crawl` | 爬取站点 | 返回多页内容 |
| `url_fetch` | 获取 URL | 返回页面内容 |
| `git_clone` | 克隆仓库 | 返回仓库内容 |
| `read_file` | 读文件 | 返回文件内容 |
| `grep_search` | 搜索文件 | 返回匹配结果 |
| `run_script` | 运行脚本 | 返回执行结果 |
| `kb_research` | 深度研究 | 返回研究报告 |

---

## 8. 配置管理 (Config)

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 8.1 | `/api/config` | GET | 无 | 返回完整配置 (apiKey 脱敏为 `****`) |
| 8.2 | `/api/config` | PUT | `{embedding: {...}, search: {...}, ...}` | `{success: true}`, 合并保存 |
| 8.3 | `/api/config` | PUT | `apiKey: "****"` | 不覆盖, 保留原值 |
| 8.4 | `/api/stats` | GET | 无 | 返回搜索/LLM/Embedding/MCP 统计数据 |
| 8.5 | `/api/stats/reset` | POST | `{type: "all"\|"search"\|"llm"\|"embedding"\|"mcp"}` | `{success: true}` |
| 8.6 | `/api/stats/usage` | GET | 无 | 返回 Tavily/Serper/SiliconFlow 用量 |

---

## 9. 安全 (Security)

| # | 场景 | 测试方法 | 预期结果 |
|---|------|----------|----------|
| 9.1 | API Key 认证 (KB_API_KEY 设置) | 不带 `Authorization: Bearer xxx` 请求任意 API | 401 `Unauthorized` |
| 9.2 | API Key 正确认证 | `Authorization: Bearer <correct_key>` | 正常返回 |
| 9.3 | API Key 错误 | `Authorization: Bearer wrong_key` | 401 |
| 9.4 | /health 免认证 | 无 Authorization 请求 `/health` | 200 (health 不受认证限制) |
| 9.5 | Rate Limiting - general 类 | 短时间内大量请求 | 429 `Too many requests` + `Retry-After` header |
| 9.6 | Rate Limiting - llm 类 | 短时间内大量 `/api/chat` 请求 | 429 |
| 9.7 | Rate Limiting - write 类 | 短时间内大量 `/api/docs/write` 请求 | 429 |
| 9.8 | Rate Limiting headers | 正常请求 | `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers |
| 9.9 | SSRF 防护 | POST `/api/web-read` `{url: "http://169.254.169.254/"}` | 400 `URL blocked` |
| 9.10 | SSRF 防护 - localhost | POST `/api/web-read` `{url: "http://127.0.0.1:6379/"}` | 400 `URL blocked` |
| 9.11 | 路径穿越 | GET `/../../etc/passwd` | 403 Forbidden |
| 9.12 | MCP 端点禁用 | `--no-mcp` 模式下访问 `/mcp`, `/sse`, `/messages` | 404 `MCP endpoints disabled` |

---

## 10. 前端 (Frontend)

### 10.1 页面加载

| # | 页面/组件 | 验证点 |
|---|-----------|--------|
| 10.1.1 | `App.tsx` | 主路由正常加载, 无白屏 |
| 10.1.2 | `Sidebar.tsx` | 侧边栏渲染, 导航切换 |
| 10.1.3 | `ModelSelector.tsx` | 模型下拉选择器, 切换模型 |

### 10.2 KB 管理

| # | 组件 | 验证点 |
|---|------|--------|
| 10.2.1 | `kb/KBPanel.tsx` | KB 面板整体渲染 |
| 10.2.2 | `kb/SearchTab.tsx` | 搜索标签页, 输入查询, 显示结果 |
| 10.2.3 | `kb/OutlineTab.tsx` | 大纲标签页, 显示项目大纲 |
| 10.2.4 | `DocViewer.tsx` | 文档查看器, 显示完整内容 |
| 10.2.5 | `FavoriteList.tsx` | 收藏列表, 添加/删除收藏 |
| 10.2.6 | `TagBadge.tsx` | 标签徽章显示 |

### 10.3 Ask 功能

| # | 组件 | 验证点 |
|---|------|--------|
| 10.3.1 | `AskPanel.tsx` | Ask 面板整体渲染 |
| 10.3.2 | `ask/AskInput.tsx` | 查询输入框, 提交查询 |
| 10.3.3 | `ask/AskEmptyState.tsx` | 空状态展示 |
| 10.3.4 | `ask/ResultCard.tsx` | 搜索结果卡片 |
| 10.3.5 | `ask/WebResultItem.tsx` | 联网搜索结果项 |
| 10.3.6 | `ask/PipelineResultsCard.tsx` | 管线结果卡片 |
| 10.3.7 | `ask/ResearchResultCard.tsx` | 研究结果卡片 |
| 10.3.8 | `ask/AgentResearchCard.tsx` | Agent 研究进度卡片 |

### 10.4 Chat 功能

| # | 组件 | 验证点 |
|---|------|--------|
| 10.4.1 | `ChatPanel.tsx` | 聊天面板整体渲染 |
| 10.4.2 | `chat/ChatInput.tsx` | 消息输入框 |
| 10.4.3 | `chat/ChatMessage.tsx` | 消息气泡渲染 |
| 10.4.4 | `chat/ToolCallDisplay.tsx` | 工具调用展示 |
| 10.4.5 | `chat/SessionList.tsx` | 会话列表 |
| 10.4.6 | `chat/SessionItem.tsx` | 会话项 |
| 10.4.7 | `chat/SessionContextMenu.tsx` | 会话右键菜单 (重命名/删除) |

### 10.5 设置

| # | 组件 | 验证点 |
|---|------|--------|
| 10.5.1 | `SettingsPanel.tsx` | 设置面板整体渲染 |
| 10.5.2 | `settings/EmbeddingSection.tsx` | Embedding 配置 |
| 10.5.3 | `settings/SearchSection.tsx` | 搜索配置 |
| 10.5.4 | `settings/WebSearchSection.tsx` | 联网搜索配置 |
| 10.5.5 | `settings/SearchPipelineSection.tsx` | 搜索管线配置 |
| 10.5.6 | `settings/BrowserConfigSection.tsx` | 浏览器配置 |
| 10.5.7 | `settings/SkillPathsSection.tsx` | Skill 路径配置 |

### 10.6 通用组件

| # | 组件 | 验证点 |
|---|------|--------|
| 10.6.1 | `SearchPalette.tsx` | 全局搜索面板 (Cmd+K) |
| 10.6.2 | `MarkdownRenderer.tsx` | Markdown 渲染 |
| 10.6.3 | `LazyCodeBlock.tsx` | 代码块懒加载 |
| 10.6.4 | `CopyButton.tsx` | 复制按钮功能 |
| 10.6.5 | `Skeleton.tsx` | 加载骨架屏 |
| 10.6.6 | `ErrorBoundary.tsx` | 错误边界捕获 |

---

## 11. 降级场景 (Degradation / Fallback)

### 11.1 搜索源降级

| # | 场景 | 触发条件 | 预期降级行为 |
|---|------|----------|-------------|
| 11.1.1 | web-search-prime 不可用 | MCP quota 超限或未连接 | `available()=false`, 跳过此源 |
| 11.1.2 | tavily 不可用 | 无 apiKey | `available()=false`, 跳过 |
| 11.1.3 | serper 不可用 | 无 apiKey | `available()=false`, 跳过 |
| 11.1.4 | xbrowser 不可用 | CLI 未安装或 disabled | `available()=false`, 跳过 |
| 11.1.5 | ai-search 不可用 | 无 zhipu API key | `available()=false`, 跳过 |
| 11.1.6 | llm-direct 不可用 | 无 apiKey | `available()=false`, 跳过 |
| 11.1.7 | 所有搜索源不可用 | 全部未配置 | SearchPipeline 返回空结果 |

### 11.2 搜索模式降级

| # | 场景 | 触发条件 | 预期降级行为 |
|---|------|----------|-------------|
| 11.2.1 | combined search → keyword fallback | searchDocsCombined 抛异常 | 捕获异常, fallback 到 `searchDocs()` |
| 11.2.2 | semantic search → keyword fallback | `config.search.mode="semantic"` + semantic 超时/失败 | fallback 到 `searchDocs()` |
| 11.2.3 | tfidf search 失败 | searchDocsCombined 中 tfidf Promise reject | 跳过 tfidf 结果, 仅用 keyword + semantic |
| 11.2.4 | semantic search 失败 | searchDocsCombined 中 semantic Promise reject | 跳过 semantic, 仅用 keyword + tfidf |

### 11.3 Web Read 降级链

| # | 场景 | 降级顺序 |
|---|------|----------|
| 11.3.1 | xbrowser → MCP readUrl → fetch | `/api/web-read` / `/api/ask-deep-read` 的读取降级链 |
| 11.3.2 | MCP readUrl → fetch | xbrowser 未启用时 |
| 11.3.3 | fetch only | MCP 不可用时 |
| 11.3.4 | 全部失败 | `/api/web-read`: 500; `/api/ask-deep-read`: 503 |

### 11.4 LLM 降级

| # | 场景 | 触发条件 | 预期降级行为 |
|---|------|----------|-------------|
| 11.4.1 | Chat 无 model | 未配置任何 API key | SSE error `No model available` |
| 11.4.2 | Chat model 调用失败 | API 超时/错误 | SSE error + 异常信息 |
| 11.4.3 | Research evaluate LLM 失败 | ask-research LLM 筛选失败 | fallback: 取前 5 条结果 |
| 11.4.4 | Research summary LLM 失败 | ask-research LLM 摘要失败 | fallback: 拼接原文摘要 |
| 11.4.5 | Research summary 返回空/短 | LLM 返回 < 50 字符 | fallback 拼接摘要 |

### 11.5 Embedding 降级

| # | 场景 | 触发条件 | 预期降级行为 |
|---|------|----------|-------------|
| 11.5.1 | Embedding 未启用 | `config.embedding.enabled=false` | semantic search 不可用, combined search 跳过 semantic |
| 11.5.2 | Embedding API 调用失败 | API 错误 | searchDocsCombined 中 semantic Promise reject, 跳过 |
| 11.5.3 | Vector store 空文档 | 首次使用无向量数据 | semantic search 返回空结果 |

### 11.6 MCP 降级

| # | 场景 | 触发条件 | 预期降级行为 |
|---|------|----------|-------------|
| 11.6.1 | MCP 模式禁用 | `--no-mcp` 启动 | `/mcp`, `/sse`, `/messages` 返回 404 |
| 11.6.2 | MCP 断开连接 | MCP client 连接断开 | webSearch 不可用, web-search-prime 报告 unavailable |

---

## 12. MCP 协议端点

| # | 端点 | 方法 | 参数 | 预期结果 |
|---|------|------|------|----------|
| 12.1 | `/mcp` | POST | JSON-RPC request | Streamable HTTP MCP 响应 |
| 12.2 | `/sse` | GET | 无 | SSE 连接建立, 发送 MCP events |
| 12.3 | `/messages` | POST | JSON-RPC message | MCP message 处理 |

---

## 附录 A: 验证优先级

| 优先级 | 类别 | 说明 |
|--------|------|------|
| P0 | 基础设施 + 安全 | 服务能启动、认证、限流 |
| P0 | 文档 CRUD | 核心功能不可用则全部阻塞 |
| P1 | 本地搜索 | keyword/tfidf/semantic/combined |
| P1 | Chat | 对话 + 工具调用 |
| P1 | Ask 管线 | KB ask + 联网搜索 |
| P2 | Research | 深度研究 + evolution |
| P2 | 配置管理 | 前端设置页 |
| P3 | 前端 UI | 组件交互验证 |
| P3 | 降级场景 | 各种失败场景 |

## 附录 B: 测试统计

| 类别 | 测试项数 |
|------|----------|
| 1. 基础设施 | 7 |
| 2. 文档 CRUD | 13 |
| 3. 本地搜索 | 12 |
| 4. 联网搜索 | 7 |
| 5. Ask 管线 | 5 |
| 6. Research | 19 |
| 7. Chat | 23 |
| 8. 配置管理 | 6 |
| 9. 安全 | 12 |
| 10. 前端 | 30 |
| 11. 降级场景 | 18 |
| 12. MCP 协议 | 3 |
| **总计** | **155** |
