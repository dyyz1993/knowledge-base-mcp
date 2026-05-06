const SYNONYMS = new Map<string, string[]>([
  ["react", ["react", "React", "reactjs", "react.js", "前端框架", "前端项目", "spa", "单页应用"]],
  ["vue", ["vue", "Vue", "vuejs", "vue3", "vue2"]],
  ["nextjs", ["next", "Next.js", "nextjs", "ssr", "服务端渲染", "全栈框架"]],
  ["nuxt", ["nuxt", "Nuxt", "nuxt3"]],
  ["vite", ["vite", "Vite", "构建工具", "前端构建", "打包工具"]],
  ["webpack", ["webpack", "Webpack", "打包", "bundler"]],
  ["esbuild", ["esbuild", "ESBuild"]],
  ["turbo", ["turbopack", "Turbopack", "turbo"]],
  ["scaffold", ["脚手架", "scaffold", "搭建", "初始化", "项目初始化", "create", "starter", "template", "模板"]],
  ["cra", ["create-react-app", "cra", "react-app"]],
  ["tailwind", ["tailwind", "Tailwind", "tailwindcss", "原子化CSS", "css框架"]],
  ["css", ["css", "CSS", "样式", "stylesheet"]],
  ["zustand", ["zustand", "Zustand", "状态管理"]],
  ["redux", ["redux", "Redux", "状态容器"]],
  ["pinia", ["pinia", "Pinia"]],
  ["typescript", ["typescript", "TypeScript", "ts", "类型系统", "类型安全"]],
  ["javascript", ["javascript", "JavaScript", "js", "ecmascript"]],
  ["bun", ["bun", "Bun", "运行时", "javascript runtime"]],
  ["node", ["node", "Node.js", "nodejs", "后端运行时"]],
  ["deno", ["deno", "Deno"]],
  ["vitest", ["vitest", "Vitest", "测试框架", "单元测试"]],
  ["playwright", ["playwright", "Playwright", "e2e测试", "端到端测试"]],
  ["jest", ["jest", "Jest", "测试"]],
  ["llm", ["llm", "LLM", "大语言模型", "ai", "AI", "人工智能"]],
  ["openai", ["openai", "OpenAI", "gpt", "GPT"]],
  ["claude", ["claude", "Claude", "anthropic"]],
  ["glm", ["glm", "GLM", "智谱", "zhipuai"]],
  ["deepseek", ["deepseek", "DeepSeek"]],
  ["docker", ["docker", "Docker", "容器化", "container"]],
  ["kubernetes", ["kubernetes", "k8s", "K8s", "k8s集群"]],
  ["cicd", ["cicd", "CI/CD", "持续集成", "持续部署", "github actions", "gitlab ci"]],
  ["nginx", ["nginx", "Nginx", "反向代理", "web服务器"]],
  ["mongodb", ["mongodb", "MongoDB", "mongo", "nosql", "文档数据库"]],
  ["postgresql", ["postgresql", "PostgreSQL", "postgres", "pg", "关系型数据库"]],
  ["redis", ["redis", "Redis", "缓存"]],
  ["prisma", ["prisma", "Prisma", "orm", "ORM"]],
  ["drizzle", ["drizzle", "Drizzle", "drizzle-orm"]],
  ["microservice", ["微服务", "microservice", "microservices", "分布式"]],
  ["monorepo", ["monorepo", "Monorepo", "单体仓库", "pnpm workspace", "turborepo"]],
  ["mvc", ["mvc", "MVC", "model-view-controller"]],
  ["clean architecture", ["整洁架构", "clean architecture", "六边形架构", "hexagonal"]],
  ["mcp", ["mcp", "MCP", "model context protocol", "模型上下文协议"]],
  ["agent", ["agent", "Agent", "智能体", "agent架构"]],
  ["git", ["git", "Git", "版本控制"]],
  ["github", ["github", "GitHub"]],
  ["api", ["api", "API", "接口", "restful", "RESTful", "graphql"]],
  ["deploy", ["deploy", "部署", "发布", "上线"]],
  ["python", ["python", "Python", "py"]],
  ["go", ["go", "Go", "golang"]],
  ["rust", ["rust", "Rust"]],
])

const TYPOS: [string, string][] = [
  ["reacct", "react"], ["reaact", "react"], ["reacctjs", "reactjs"],
  ["vie", "vue"], ["vuue", "vue"],
  ["tyepscript", "typescript"], ["javascipt", "javascript"],
  ["tailwidn", "tailwind"],
  ["doker", "docker"], ["dockers", "docker"],
  ["nodejs", "node"], ["nodej", "node"],
  ["pyhton", "python"], ["phyton", "python"],
  ["githab", "github"],
  ["apii", "api"],
]

const STOP_WORDS = new Set([
  "的", "了", "是", "在", "我", "你", "他", "她", "它", "们",
  "这", "那", "个", "什", "么", "怎", "如何", "哪", "几", "多",
  "能", "会", "要", "想", "帮", "给", "请", "让", "被", "把",
  "和", "与", "或", "但", "而", "也", "就", "都", "很", "非常",
  "一", "二", "三", "不", "没", "有", "用", "做", "来", "去",
  "上", "下", "前", "后", "里", "外", "中", "好", "对", "可以",
  "需要", "知道", "告诉", "说说", "介绍", "说明", "描述", "关于",
  "问题", "方法", "方式", "比如", "例如", "包括", "以及", "等等",
  "搞", "一个", "想要", "帮我", "怎么",
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "and", "but", "or", "nor", "so", "yet", "both", "either", "neither",
  "not", "only", "own", "same", "than", "too", "very", "just",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "am", "how", "why", "where", "when", "if", "then", "there", "here",
])

function tokenizeQuery(query: string): string[] {
  const tokens: string[] = []
  const parts = query.split(/[\s,，.。!！?？;；:：、""''（）()\[\]{}\/\\|@#$%^&*+=<>`~]+/)
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed || trimmed.length < 2) continue
    const segments = trimmed.match(/([a-zA-Z0-9_.-]+|[\u4e00-\u9fff]+)/g)
    if (segments) tokens.push(...segments)
    else tokens.push(trimmed)
  }
  return tokens
}

function isChinese(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s)
}

function isEnglish(s: string): boolean {
  return /^[a-zA-Z]/.test(s)
}

export function expandQuery(query: string): string[] {
  const keywords = new Set<string>()
  const trimmed = query.trim()
  if (!trimmed) return []

  keywords.add(trimmed)

  const normalized = trimmed.toLowerCase()

  for (const [typo, correct] of TYPOS) {
    if (normalized.includes(typo)) {
      const corrected = normalized.replace(typo, correct)
      keywords.add(corrected)
      const synonyms = SYNONYMS.get(correct)
      if (synonyms) synonyms.forEach((s) => keywords.add(s))
    }
  }

  for (const [, synonyms] of SYNONYMS) {
    if (synonyms.some((s) => normalized.includes(s.toLowerCase()))) {
      synonyms.forEach((s) => keywords.add(s))
    }
  }

  const tokens = tokenizeQuery(trimmed)
  for (const token of tokens) {
    if (token.length < 2 || STOP_WORDS.has(token.toLowerCase())) continue
    keywords.add(token)

    const tokenLower = token.toLowerCase()
    for (const [root, synonyms] of SYNONYMS) {
      if (tokenLower === root || tokenLower.includes(root) || root.includes(tokenLower)) {
        synonyms.forEach((s) => keywords.add(s))
      }
    }
  }

  const chineseTerms = Array.from(keywords).filter(isChinese)
  const englishTerms = Array.from(keywords).filter(isEnglish)

  for (const cn of chineseTerms) {
    for (const [, synonyms] of SYNONYMS) {
      if (synonyms.some((s) => s === cn)) {
        const enMatches = synonyms.filter(isEnglish)
        enMatches.forEach((s) => keywords.add(s))
      }
    }
  }

  for (const en of englishTerms) {
    for (const [, synonyms] of SYNONYMS) {
      if (synonyms.some((s) => s.toLowerCase() === en.toLowerCase())) {
        const cnMatches = synonyms.filter(isChinese)
        cnMatches.forEach((s) => keywords.add(s))
      }
    }
  }

  const result = Array.from(keywords)
  const originalIndex = result.indexOf(trimmed)
  if (originalIndex > 0) {
    result.splice(originalIndex, 1)
    result.unshift(trimmed)
  }

  return result.slice(0, 15)
}
