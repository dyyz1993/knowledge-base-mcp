# Knowledge Base MCP 服务 - 执行文档

## 一、项目定位

跨项目知识沉淀服务，支持方法论、架构设计、错误经验、最佳实践等文档的结构化存储、检索和复用。

## 二、项目信息

- **项目路径**: `/Users/xuyingzhou/Project/temporary/knowledge-base-mcp/`
- **存储目录**: `~/.knowledge/`（共享存储，MCP 服务 + 插件 + Web Viewer 都读写这里）
- **技术栈**: Bun + TypeScript + `@modelcontextprotocol/server`（MCP） + Vite + React + Tailwind（Web UI）

## 三、项目结构

```
/Users/xuyingzhou/Project/temporary/knowledge-base-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # MCP 服务入口（stdio + HTTP 双模式）
│   ├── tools/
│   │   ├── write.ts        # kb_write
│   │   ├── read.ts         # kb_read
│   │   ├── search.ts       # kb_search
│   │   ├── list.ts         # kb_list
│   │   ├── delete.ts       # kb_delete
│   │   ├── update.ts       # kb_update
│   │   └── outline.ts      # kb_outline
│   ├── storage/
│   │   ├── index.ts        # 索引读写（~/.knowledge/index.json）
│   │   └── markdown.ts     # frontmatter 解析/生成
│   └── search/
│       └── text.ts         # P0 文本匹配 matchScore
├── web/                    # Vite + React + TypeScript
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   │   ├── Sidebar.tsx       # 项目分组文档列表
│   │   │   ├── DocViewer.tsx     # Markdown 渲染 + 代码高亮 + 复制
│   │   │   ├── SearchPalette.tsx # Cmd+K 搜索弹窗
│   │   │   ├── TagBadge.tsx      # 标签徽章
│   │   │   └── CopyButton.tsx    # 通用复制按钮
│   │   ├── hooks/
│   │   │   ├── useDocs.ts        # 文档数据获取
│   │   │   └── useSearch.ts      # 搜索逻辑
│   │   ├── api/
│   │   │   └── index.ts          # API 调用封装
│   │   └── styles/
│   │       └── index.css         # Tailwind 全局样式
│   └── tsconfig.json
└── README.md
```

## 四、7 个 MCP 工具

### 4.1 kb_write（保存文档）

**必填入参**:
- `title`: 文档标题（简明扼要）
- `content`: 文档正文（Markdown 格式）
- `tags`: 类型标签数组，至少一个（tutorial/document/analysis/guide/snippet/best-practice/reference/architecture/troubleshooting/decision）
- `keywords`: 关键词数组，至少一个，用于检索
- `intent`: 创建此文档的意图或使用场景说明
- `project_description`: 当前项目简要描述

**自动生成**:
- `id`: 唯一标识
- `source_project`: 当前项目绝对路径（从 MCP context 获取）
- `source_worktree`: 项目 worktree 根路径
- `created_at`: 创建时间戳
- `file_path`: 磁盘存储绝对路径

**返回**: id, file_path, reference 引用信息

**副作用**: 写入后自动更新项目大纲文件 `~/.knowledge/outlines/{project-slug}.json`

**description 里引导 LLM**: 当识别到跨项目可复用的方法论、架构模式、错误经验时，主动建议保存。

### 4.2 kb_read（读取文档）

**入参**: `id`（文档 ID）

**返回**: meta + content

**长度限制**: 超 50 行自动截断，返回 `truncated: true` + 文件绝对路径，引导用子任务读取全文

### 4.3 kb_search（搜索文档）

**入参**:
- `query?`: 自由文本搜索（匹配标题/关键词/意图）
- `keywords?`: 按关键词过滤
- `tags?`: 按标签类型过滤
- `limit?`: 返回数量上限（默认 10）

**返回**: 匹配文档列表（不含 content）+ source_project + 相关度评分

**搜索权重**:
| 匹配位置 | 权重 |
|----------|------|
| title 包含 query | +10 |
| keywords 包含 query | +4 |
| intent 包含 query | +5 |
| project_description 包含 query | +3 |
| tags 精确匹配 | +5 |
| keywords 参数匹配 | +3 |
| title 参数匹配 | +2 |

### 4.4 kb_list（列表浏览）

**入参**: `tag?`（按标签过滤）, `project?`（按项目路径过滤）

**返回**: 文档摘要列表（id, title, tags, keywords, source_project, created_at）

### 4.5 kb_outline（项目大纲）

**入参**: `project`（项目绝对路径）

**返回**: 该项目的所有文档索引（id, title, tags, keywords），按创建时间排序

**大纲文件路径**: `~/.knowledge/outlines/{slugified-project-name}.json`

### 4.6 kb_delete（删除文档）

**入参**: `id`

**返回**: success/fail

**副作用**: 同步更新 index.json + 项目大纲文件

### 4.7 kb_update（更新文档）

**入参**: `id`, `content?`, `title?`, `tags?`, `keywords?`

**返回**: 更新后的 meta

**副作用**: 同步更新 index.json + 项目大纲文件 + Markdown 文件

## 五、存储格式

### 5.1 文档文件

路径: `~/.knowledge/{id}-{slugified-title}.md`

```markdown
---
id: "abc123lm0"
title: "文档标题"
tags: ["tutorial", "guide"]
keywords: ["react", "hooks"]
intent: "使用场景说明"
project_description: "当前项目描述"
source_project: "/Users/x/project-a"
source_worktree: "/Users/x/project-a"
created_at: 1746012345678
file_path: "/Users/xuyingzhou/.knowledge/abc123lm0-xxx.md"
---

文档正文（Markdown）
```

### 5.2 索引文件

路径: `~/.knowledge/index.json`

```json
{
  "version": 1,
  "documents": {
    "abc123lm0": {
      "id": "abc123lm0",
      "title": "...",
      "tags": [...],
      "keywords": [...],
      "intent": "...",
      "project_description": "...",
      "source_project": "/Users/x/project-a",
      "source_worktree": "/Users/x/project-a",
      "created_at": 1746012345678,
      "file_path": "/Users/xuyingzhou/.knowledge/abc123lm0-xxx.md"
    }
  }
}
```

### 5.3 项目大纲文件

路径: `~/.knowledge/outlines/{slugified-project-name}.json`

```json
{
  "project": "/Users/x/project-a",
  "updated_at": 1746012345678,
  "docs": [
    { "id": "abc", "title": "RpcClient 完整参考", "tags": ["reference"], "keywords": ["rpc"] },
    { "id": "def", "title": "插件测试指南", "tags": ["tutorial"], "keywords": ["test"] }
  ]
}
```

## 六、双模式运行

| 模式 | 启动方式 | 用途 |
|------|---------|------|
| **stdio** | `bun run src/index.ts --stdio` | 被 opencode/Cursor/Claude Desktop 作为 MCP 客户端连接 |
| **http** | `bun run src/index.ts --http --port 19877` | 启动 Web Viewer + HTTP API + SSE MCP |

## 七、Web UI 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 构建 | Vite + TypeScript | 快速构建 |
| 框架 | React | 组件化 |
| 样式 | Tailwind CSS | 快速开发 |
| Markdown | react-markdown + remark-gfm | 渲染 + GFM 支持 |
| 代码高亮 | react-syntax-highlighter | 带 Copy 按钮 |
| 搜索弹窗 | cmdk | Cmd+K 组件 |

## 八、Web UI 功能

- **左侧边栏**: 按项目分组文档列表，可折叠
- **主内容区**: Markdown 渲染 + 语法高亮 + 代码块复制按钮
- **Cmd+K 搜索弹窗**: 快速搜索文档
- **标签徽章**: 彩色标签显示
- **Copy Reference 按钮**: 一键复制文档引用（给 AI 看的格式）
- **深色主题**
- **项目大纲**: 展示当前项目所有文档概览

## 九、opencode 配置

```json
{
  "mcp": {
    "knowledge-base": {
      "type": "local",
      "command": ["bun", "run", "/Users/xuyingzhou/Project/temporary/knowledge-base-mcp/src/index.ts", "--stdio"]
    }
  }
}
```

## 十、与现有系统的关系

```
~/.knowledge/                          ← 共享存储目录
~/.config/opencode/
  ├── plugins/knowledge-base.ts        ← 保留插件（仅做 hook 拦截引导子任务）
  └── command/kb-*.md                  ← 保留快捷命令
~/Project/temporary/knowledge-base-mcp/ ← MCP 服务（独立进程）
```

## 十一、搜索能力演进路线

| 阶段 | 方案 | 依赖 | 效果 |
|------|------|------|------|
| **P0**（先做） | 文本匹配 matchScore | 无 | 标题/关键词/意图模糊匹配 |
| **P1**（迭代） | TF-IDF + 余弦相似度 | 无（纯 TS） | 自动提取特征词，更准确排序 |
| **P2**（迭代） | embedding 语义搜索 | @xenova/transformers | 语义匹配，跨语言检索 |

## 十二、开发顺序

1. **MCP 服务核心** — 项目初始化 + 存储层 + 7 个工具 + 双模式入口
2. **Vite + React Web UI** — 组件化重写 Viewer
3. **集成测试** — 验证 MCP 客户端连接 + Web UI 正常工作
4. **opencode 配置** — 配置 MCP 连接 + 保留插件做 hook 拦截

## 十三、核心设计原则

1. **所有路径用绝对路径** — 跨项目引用不会出错
2. **自动记录 source_project** — 每篇文档可追溯到来源项目
3. **写入时更新项目大纲** — 快速了解某项目沉淀了哪些知识
4. **大文档自动截断** — 避免占满主上下文
5. **description 引导 LLM 主动保存** — 识别到好内容时自动建议写入
6. **tool.definition hook 引导子任务** — 大文档读取走子任务，不占主上下文
