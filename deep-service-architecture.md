# 深度知识服务架构设计

## 核心思路：从一个被动存储的仓库 → 一个主动生长的知识工人

### 现状

```
用户 → kb_write（手动存） → 知识库 → kb_search（手动查） → 用户
```

所有知识依赖人工输入，不会自己生长。

### 目标

```
外部数据源 ──→ 内置 Reader ──→ 分析/加工 ──→ 知识库 ──→ 越用越聪明
                    ↑                              │
                    └──── 自动化层（调度/触发）──────┘
```

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────┐
│                   用户 / MCP 客户端                    │
└──────────┬──────────────────────────────┬───────────┘
           │ MCP Tool 调用                 │ MCP Tool 调用
           ▼                               ▼
┌──────────────────┐            ┌──────────────────────┐
│   主动查询层       │            │    自动化层            │
│  kb_query         │            │  kb_watch            │
│  kb_ask           │            │  kb_schedule         │
│  kb_suggest       │            │  kb_stale_check      │
└────────┬─────────┘            └──────────┬───────────┘
         │                                  │
         ▼                                  ▼
┌──────────────────────────────────────────────────────┐
│                    处理引擎                            │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────┐  │
│  │ Reader   │  │ Search   │  │ Analyze  │  │Store │  │
│  │          │  │          │  │          │  │      │  │
│  │· web     │  │· web     │  │· 摘要    │  │· 去重 │  │
│  │· file    │  │· code    │  │· 实体提取│  │· 写入 │  │
│  │· code    │  │· kb内部  │  │· 质量评分│  │· 索引 │  │
│  │· package │  │          │  │· 关系识别│  │· 关联 │  │
│  └──────────┘  └──────────┘  └──────────┘  └──────┘  │
└──────────────────────────────────────────────────────┘
```

---

## 二、三层能力扩展

### Layer 1：内置 Reader（输入层）

把现有的 file_read/file_grep 扩展为一组强大的 Reader 工具：

| Reader | 功能 | 数据源 |
|--------|------|--------|
| `reader_url` | 抓取 URL 内容，转 Markdown | 网页 |
| `reader_file` | ✅ 已实现（file_read） | 本地文件 |
| `reader_grep` | ✅ 已实现（file_grep） | 文件搜索 |
| `reader_search` | 调用外部搜索引擎 | Web |
| `reader_npm` | 读取 npm 包信息 | npm registry |
| `reader_github` | 读取 GitHub 仓库内容 | GitHub API |
| `reader_mcp` | 调用其他 MCP 服务的工具 | 其他 MCP 服务 |

**关键：这些 Reader 不仅仅是返回结果，它们还能自动决定「要不要存」。**

### Layer 2：分析引擎（加工层）

每个 Reader 获取的数据会经过分析管道：

```
原始数据 → 清洗 → 结构化 → 打分 → 存或不存
```

**分析管道组件：**

1. **去重检测（Dedup）** — 内容是否已在知识库中？相似度 > 0.85 跳过
2. **质量评分（Scorer）** — 内容是否有长期价值？
   - 代码解决方案 → 高分
   - 临时性新闻 → 低分（不存或短生命周期）
3. **摘要生成（Summarizer）** — 长内容自动摘要
4. **实体提取（Entity Extractor）** — 提取关键词、技术名词、项目名
5. **关系识别（Relation）** — 自动关联已有文档

### Layer 3：自动化层（生长机制）

这才是「越用越厉害」的核心：

| 机制 | 说明 | 实现方式 |
|------|------|----------|
| **Stale Check** | 定期检查 `related_files` 是否变化，若变化则更新 | 对比文件 mtime + hash |
| **Auto-Ingest** | 访问某个 URL 时自动存一份到 KB | reader_url 内嵌 kb_write |
| **Usage Boost** | 经常被搜到的文档提高权重 | 搜索日志记录 + 权重调整 |
| **Cross-Link** | 发现相关文档自动建立关联 | 语义相似度 > 0.7 自动关联 |
| **Auto-Tag** | 根据内容自动打标签 | LLM 分类 + 规则兜底 |
| **Crawl Path** | 从已知 URL 发现新 URL 继续抓取 | 提取页面链接递归处理 |

---

## 三、典型工作流

### 场景 1：遇到一个 Bug

```
用户: "TypeError: Cannot read property 'map' of undefined"

1. kb_query("TypeError Cannot read property map")
   → 搜索 KB，发现已有记录 → 直接返回（秒级）

   如果没有命中：

2. kb_ask("TypeError Cannot read property map")
   → 触发自动查询链：
   ├─ web_search("TypeError Cannot read property map undefined")
   │  → 找到 StackOverflow 链接
   │  → reader_url(SO链接)
   │  → 提取解决方案
   │  → 质量评分（高：这是可复用的知识）
   │  → 去重检查（否：还没存过）
   │  → kb_write(title="TypeError map of undefined 解决方案", ...)
   │
   ├─ file_grep(project, "\.map\(")
   │  → 找到本地代码中的类似用法
   │  → 生成代码上下文
   │
   └─ 汇总所有信息 → 返回给用户 + 持久化到 KB
```

**关键效果**：第一个人可能需要几分钟解决，第二个人搜索 KB 直接秒回。团队的知识随着使用自动积累。

### 场景 2：学习一个新项目

```
用户: "帮我分析一下这个项目 /path/to/project"

1. kb_scan_project("/path/to/project")
   ├─ 扫描目录结构
   ├─ 读取 package.json → 识别技术栈
   ├─ 读取入口文件 → 理解架构
   ├─ 搜索关键模式 → 识别核心模块
   ├─ 生成项目知识文档
   └─ kb_write 多篇文档到知识库
```

### 场景 3：自动维护知识新鲜度

```
设置 kb_watch 后：

定时任务每分钟：
├─ 遍历所有有 related_files 的文档
├─ 检查文件 mtime 是否变化
├─ 如果有变化 → 重新读取 → 更新 KB 文档
└─ 如果文件已删除 → 标记为过期
```

---

## 四、新增 MCP 工具设计

```typescript
// ========== 查询工具 ==========

// 智能查询：先搜 KB，没命中再搜外部，自动沉淀
kb_ask(query: string, options?: { auto_save?: boolean })
// 返回：{ from_kb: bool, answer: string, sources: [...] }

// 项目分析
kb_scan_project(path: string, depth?: number)
// 返回：{ documents: [...], modules: [...], tech_stack: [...] }

// 自动检索并沉淀
kb_ingest_url(url: string)
kb_ingest_search(query: string, max_results?: number)

// ========== 自动化工具 ==========

// 检查知识过期
kb_stale_check()
// 返回：{ stale: [...], updated: [...], deleted: [...] }

// 设置文件监听
kb_watch(path: string, doc_id?: string)

// ========== 关联工具 ==========

// 查找关联文档
kb_related(id: string)

// 自动关联（全量遍历）
kb_auto_link()
```

---

## 五、"越用越厉害" 的具体机制

### 机制 1：搜索即沉淀

```
用户第 1 次搜索 "React useEffect cleanup"
→ KB 没有 → 触发外部搜索 → 整理结果 → 存储
→ 用户第 2 次搜索 → KB 直接命中

效果：团队每解决一个问题，整个团队都受益。
```

### 机制 2：热度加权

```
记录每个文档的搜索命中次数 + 被引用次数：
- 高频文档 → 提高搜索权重
- 低频文档 → 降低权重（但不删除）

这样好内容自然浮上来。
```

### 机制 3：自动关联网络

```
文档 A（React Hooks）和 文档 B（useEffect cleanup）
语义相似度 0.82 → 自动建立双向链接

当用户搜索任一文档时，关联文档也会展示。
逐步形成一个知识图谱。
```

### 机制 4：自我修复

```
文件 /project/src/hooks.ts 被修改了
→ stale_check 检测到 mtime 变化
→ 重新读取文件
→ 对比 KB 中的内容
→ 如果关键信息变化 → 更新 KB 文档
→ 如果只是格式变化 → 跳过
```

---

## 六、与当前项目的集成路径

### Phase 1：Reader 集成（当前已完成）

```
✅ file_read    — 读文件
✅ file_grep    — 搜索文件  
✅ file_exists  — 检查路径
```

### Phase 2：搜索集成（下一步）

```
◻ reader_url     — 抓取网页
◻ reader_search  — 联网搜索
◻ kb_ask         — 智能查询
  → 用到 @dyyz1993/pi-ai（已有依赖）
```

### Phase 3：自动化集成

```
◻ kb_scan_project   — 项目扫描分析
◻ kb_stale_check    — 过期检查
◻ kb_watch          — 文件监听
◻ kb_auto_link      — 自动关联
```

### Phase 4：自我进化

```
◻ 搜索热度记录
◻ 质量评分模型
◻ 自动标签分类
◻ 知识图谱可视化
```

---

## 七、关键设计决策

### 存什么？不存什么？

| 存 | 不存 |
|----|------|
| 技术解决方案 | 临时新闻 |
| 架构决策记录 | 个人笔记 |
| 项目知识文档 | 隐私信息 |
| 可复用的最佳实践 | 一次性对话 |
| 外部搜索结果（处理后） | 原始搜索页 |

### 去重策略

```
精确去重：全文 hash 匹配
模糊去重：P2 语义相似度 > 0.85 视为重复
合并策略：如果相似但不同 → 合并内容 → 增加关联
```

### 安全边界

```
- reader 工具只读不写（写走 kb_write）
- 文件路径限制（已在当前 file_read 里验证）
- 网络请求超时控制
- 外部搜索可开关（隐私场景可关闭）
```

---

## 八、技术栈现状

当前项目已经具备了很多基础能力，扩展成本很低：

| 现有能力 | 用于 |
|----------|------|
| `@dyyz1993/pi-ai` | LLM 调用（摘要/分类/打分） |
| P2 语义向量 | 去重检测、关联发现 |
| HTTP 服务器 | 支持 StreamableHTTP 远程访问 |
| TF-IDF + 文本匹配 | 快速检索 |
| Zod 参数校验 | 安全的工具参数 |
| file_read/file_grep | Reader 基础设施 |
| Web UI | 将来可做知识图谱可视化 |

最大优势是：**AI 能力（pi-ai）+ 存储能力（KB）+ 文件访问能力（file tools）已经在同一个服务里了**，组合它们不需要额外的技术栈。

---

## 九、一句话总结

> **把 KB-MCP 从「一个你可以往里写东西的仓库」
> 变成「一个会自己学习、自己整理、越用越懂你和你的项目的知识工人」。**

核心公式：**Reader（感知）→ Analyzer（思考）→ KB（记忆）→ Feedback（进化）**
