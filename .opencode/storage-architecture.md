# Knowledge-Base-MCP 存储架构

## 目录总览
```
~/.kb-chat/         (getDataDir) — 运行时数据
~/.knowledge/       (getKbDir)   — 知识文档
.codegraph/         (项目级)      — 代码图谱
```

## 详细结构

### ~/.kb-chat/（运行时数据，getDataDir()）
| 文件/目录 | 大小 | 用途 |
|-----------|------|------|
| config.json | 364B | 全局配置 |
| sessions/ | 4.1M | 661 个会话 JSONL |
| favorites.json | 3.5K | 收藏文档 ID |
| session-favorites.json | 206B | 会话级收藏 |
| stats/ | 16K | 调用统计 |

### ~/.knowledge/（知识文档，getKbDir()）
| 文件/目录 | 大小 | 用途 |
|-----------|------|------|
| *.md | ~8M (832文件) | 知识文档正文 |
| index.json | 799K | 文档元数据索引 |
| miss-log.json | 2.1K | 搜索未命中记录 |
| vectors.json | 3.4M | TF-IDF 向量 |
| embeddings.db | 5.9M | 语义向量 SQLite |
| outlines/ | 800K (181文件) | 项目大纲 JSON |

### .codegraph/（项目级，跟随项目）
| 文件 | 大小 | 用途 |
|------|------|------|
| codegraph.db | 4.8M | 代码图谱 SQLite |

## 环境变量控制
| 环境变量 | 默认值 | 影响 |
|----------|--------|------|
| KB_DIR | 未设置 | 同时影响 getDataDir() 和 getKbDir() |
| KB_DIR 未设置时 | getDataDir → ~/.kb-chat, getKbDir → ~/.knowledge | 两个不同路径 |
| KB_DIR 设置后 | 两个函数返回同一路径 | ⚠️ 数据会混放 |

## 路径引用代码位置
| 文件 | 行 | 硬编码内容 | 风险 |
|------|----|-----------|------|
| config.ts | 10 | getDataDir → ~/.kb-chat | ✅ 通过函数 |
| config.ts | 14 | getKbDir → ~/.knowledge | ✅ 通过函数 |
| research.ts | 32 | ~/.kb-chat/config.json | ⚠️ 硬编码字符串 |
| tools.ts | 631 | ~/.kb-chat/config.json | ⚠️ 硬编码字符串 |
| prompt-builder.ts | 22 | ~/.knowledge/ | ⚠️ 硬编码字符串 |
| api-models.ts | 48 | ~/.pi/agent/models.json | ⚠️ 外部路径 |

## 迁移指南

### 迁移步骤
1. 复制 ~/.knowledge/ 整个目录（含 embeddings.db、vectors.json）
2. 复制 ~/.kb-chat/config.json
3. 设置新环境的 KB_DIR 或保持默认
4. 每个项目的 .codegraph/ 跟随项目 git 走

### 注意事项
- embeddings.db 和 embeddings.db-shm、embeddings.db-wal 必须一起迁移
- index.json 和 .md 文件必须对应
- sessions/ 目录可选迁移（聊天历史）
