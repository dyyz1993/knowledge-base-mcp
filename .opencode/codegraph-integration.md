# CodeGraph 集成方案

## 决策：独立 MCP + 轻量桥接

### 架构
```
PI Agent → knowledge-base-mcp（文档知识 + kb_ingest_codegraph 桥接）
PI Agent → codegraph（独立 MCP，深度代码分析）
```

### 存储位置
- codegraph 数据库：项目内 `.codegraph/codegraph.db`（跟随项目 git）
- 知识库中的代码摘要：`~/.knowledge/` 下 tag=code-index 的文档

### 集成点
- `kb_ingest_codegraph` MCP 工具（待实现）

### 设计理由
1. **独立 MCP**：codegraph 专注于 AST 解析和代码结构分析，不依赖知识库的文本检索
2. **轻量桥接**：通过 kb_ingest_codegraph 将代码摘要写入知识库，实现统一搜索
3. **存储隔离**：codegraph.db 在项目内，随 git 版本控制；知识库在用户目录，跨项目共享
