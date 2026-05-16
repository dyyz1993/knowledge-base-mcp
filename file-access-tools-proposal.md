# 建议新增：文件访问工具（File Access Tools）

## 背景

当前 MCP 服务器支持 StreamableHTTP 远程访问模式，当客户端和服务器不在同一台机器时，客户端无法直接访问服务器的文件系统。知识库文档中保存了 `related_files`（关联的源码文件路径），但没有工具来读取这些文件。

## 建议新增的 MCP 工具

### 1. file_read - 读取文件内容

**用途：** 通过绝对路径读取文件内容，支持按行范围读取

**参数：**
```typescript
{
  path: string           // 文件绝对路径
  offset?: number        // 起始行号（默认 0）
  limit?: number         // 读取行数（默认 2000）
}
```

**返回：**
```typescript
{
  path: string           // 文件路径
  exists: boolean        // 文件是否存在
  content: string        // 文件内容（带行号）
  total_lines: number   // 文件总行数
  truncated: boolean     // 是否截断
}
```

**使用场景：**
- 读取知识库 `related_files` 中引用的源码文件
- 读取服务器上的配置文件
- 按行范围读取大文件（offset/limit）

---

### 2. file_grep - 搜索文件内容

**用途：** 在指定文件中搜索文本内容

**参数：**
```typescript
{
  path: string           // 文件绝对路径
  pattern: string       // 正则表达式或搜索文本
  case_sensitive?: boolean  // 是否区分大小写（默认 false）
  regex?: boolean       // 是否使用正则表达式（默认 true）
}
```

**返回：**
```typescript
{
  path: string           // 文件路径
  exists: boolean
  matches: Array<{
    line: number         // 行号
    content: string      // 匹配行的内容
    matched_text: string // 匹配的文本
  }>
  total_matches: number  // 总匹配数
}
```

**使用场景：**
- 在源码文件中搜索函数定义
- 搜索错误日志中的关键字
- 快速定位代码中的特定模式

---

### 3. file_exists - 检查文件/目录是否存在（可选）

**用途：** 检查文件或目录是否存在，用于验证路径有效性

**参数：**
```typescript
{
  path: string           // 文件/目录绝对路径
}
```

**返回：**
```typescript
{
  path: string
  exists: boolean
  type: 'file' | 'directory' | 'not_found'
}
```

**使用场景：**
- 验证 `related_files` 中的路径是否有效
- 检查配置文件是否存在

---

## 实现示例

```typescript
import { readFileSync, existsSync } from 'node:fs'
import { z } from 'zod'

// 在 registerTools() 中添加
server.tool(
  'file_read',
  '通过绝对路径读取文件内容，支持 offset 和 limit 参数',
  {
    path: z.string().describe('文件绝对路径'),
    offset: z.number().optional().default(0).describe('起始行号（默认 0）'),
    limit: z.number().optional().default(2000).describe('读取行数（默认 2000）'),
  },
  async (args) => {
    if (!existsSync(args.path)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ path: args.path, exists: false, error: '文件不存在' }),
        }],
      }
    }

    const raw = readFileSync(args.path, 'utf-8')
    const lines = raw.split('\n')
    const totalLines = lines.length

    const start = Math.max(0, args.offset)
    const end = Math.min(totalLines, start + args.limit)
    const contentLines = lines.slice(start, end)

    const content = contentLines
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join('\n')

    const truncated = end < totalLines

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          path: args.path,
          exists: true,
          content,
          total_lines: totalLines,
          truncated,
          offset: start,
          limit: args.limit,
          ...(truncated ? { hint: `文件共${totalLines}行，当前显示第${start + 1}-${end}行` } : {}),
        }, null, 2),
      }],
    }
  },
)

server.tool(
  'file_grep',
  '在指定文件中搜索文本内容',
  {
    path: z.string().describe('文件绝对路径'),
    pattern: z.string().describe('搜索文本或正则表达式'),
    case_sensitive: z.boolean().optional().default(false).describe('是否区分大小写'),
    regex: z.boolean().optional().default(true).describe('是否使用正则表达式'),
  },
  async (args) => {
    if (!existsSync(args.path)) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ path: args.path, exists: false, error: '文件不存在' }),
        }],
      }
    }

    const raw = readFileSync(args.path, 'utf-8')
    const lines = raw.split('\n')

    const matches: Array<{ line: number; content: string; matched_text: string }> = []

    let regex: RegExp
    try {
      const flags = args.case_sensitive ? 'g' : 'gi'
      regex = new RegExp(args.pattern, flags)
    } catch (e: any) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: '正则表达式无效', detail: e.message }),
        }],
      }
    }

    lines.forEach((line, index) => {
      const match = line.match(regex)
      if (match) {
        matches.push({
          line: index + 1,
          content: line,
          matched_text: match[0],
        })
      }
    })

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          path: args.path,
          exists: true,
          matches,
          total_matches: matches.length,
        }, null, 2),
      }],
    }
  },
)
```

## 安全考虑

1. **路径白名单**（可选）  
   限制只能访问特定目录（如：`/Users/xuyingzhou/Project/`）

2. **符号链接防护**  
   使用 `realpath` 解析路径，防止路径遍历攻击

3. **文件大小限制**  
   限制单次读取的文件大小（如：最大 10MB）

4. **审计日志**  
   记录所有文件访问请求

## 实现建议

在 `src/index.ts` 的 `registerTools()` 函数中添加上述三个工具。

优先级：
1. **file_read** - 最高优先级，解决核心需求
2. **file_grep** - 高优先级，提升搜索效率
3. **file_exists** - 可选，用于验证路径

## 使用示例

### 场景 1：读取知识文档引用的源码文件

```bash
# 1. 搜索知识文档
kb_search(query="React Hooks 最佳实践")

# 2. 获取文档详情
kb_read(id="abc123")

# 返回包含 related_files: ["/Users/x/project/src/hooks/useEffect.ts"]

# 3. 读取源码文件
file_read(path="/Users/x/project/src/hooks/useEffect.ts")

# 4. 搜索特定函数
file_grep(path="/Users/x/project/src/hooks/useEffect.ts", pattern="function.*useEffect")
```

### 场景 2：跨设备协作

```bash
# 电脑 A（服务器）
npx @dyyz1993/kb-mcp --http --port 19877

# 电脑 B（客户端）
# 配置 OpenCode 使用 StreamableHTTP 连接
{
  "mcp": {
    "servers": {
      "knowledge-base": {
        "type": "streamable-http",
        "url": "http://your-server:19877/mcp"
      }
    }
  }
}

# 电脑 B 可以直接读取电脑 A 的文件
file_read(path="/Users/x/project/package.json")
```
