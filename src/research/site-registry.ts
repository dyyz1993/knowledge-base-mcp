export interface SiteEntry {
  name: string
  url: string
  domains: string[]
  topics: string[]
  description: string
  searchPattern: string
}

export const SITE_REGISTRY: SiteEntry[] = [
  // === 前端开发 ===
  { name: "MDN Web Docs", url: "https://developer.mozilla.org", domains: ["developer.mozilla.org"], topics: ["web", "html", "css", "javascript", "dom", "browser-api", "frontend"], description: "Mozilla 的 Web 技术权威文档", searchPattern: "site:developer.mozilla.org {query}" },
  { name: "React 官方文档", url: "https://react.dev", domains: ["react.dev", "legacy.reactjs.org"], topics: ["react", "jsx", "component", "hooks", "frontend", "ui-library"], description: "React 框架官方文档和教程", searchPattern: "site:react.dev {query}" },
  { name: "Vue.js 文档", url: "https://vuejs.org", domains: ["vuejs.org", "v3.vuejs.org", "cn.vuejs.org"], topics: ["vue", "vue3", "composition-api", "frontend", "ui-library"], description: "Vue.js 框架官方文档", searchPattern: "site:vuejs.org {query}" },
  { name: "Angular 文档", url: "https://angular.dev", domains: ["angular.dev", "angular.io"], topics: ["angular", "typescript", "frontend", "spa", "rxjs"], description: "Angular 框架官方文档", searchPattern: "site:angular.dev {query}" },
  { name: "Next.js 文档", url: "https://nextjs.org/docs", domains: ["nextjs.org"], topics: ["nextjs", "ssr", "ssg", "react", "fullstack", "vercel"], description: "Next.js 全栈框架文档", searchPattern: "site:nextjs.org/docs {query}" },
  { name: "TailwindCSS 文档", url: "https://tailwindcss.com/docs", domains: ["tailwindcss.com"], topics: ["tailwind", "css", "styling", "utility-css", "frontend"], description: "TailwindCSS 工具类 CSS 框架文档", searchPattern: "site:tailwindcss.com {query}" },
  { name: "TypeScript Handbook", url: "https://www.typescriptlang.org/docs", domains: ["typescriptlang.org"], topics: ["typescript", "types", " generics", "tsconfig"], description: "TypeScript 官方手册", searchPattern: "site:typescriptlang.org {query}" },

  // === 后端开发 ===
  { name: "Node.js 文档", url: "https://nodejs.org/docs", domains: ["nodejs.org", "nodejs.org/api", "nodejs.org/dist"], topics: ["nodejs", "node", "runtime", "server", "npm", "v8"], description: "Node.js 运行时官方文档", searchPattern: "site:nodejs.org {query}" },
  { name: "Express.js", url: "https://expressjs.com", domains: ["expressjs.com"], topics: ["express", "nodejs", "server", "rest-api", "middleware"], description: "Express Web 框架文档", searchPattern: "site:expressjs.com {query}" },
  { name: "Django 文档", url: "https://docs.djangoproject.com", domains: ["docs.djangoproject.com"], topics: ["django", "python", "web-framework", "orm", "rest-api"], description: "Django Python Web 框架文档", searchPattern: "site:docs.djangoproject.com {query}" },
  { name: "FastAPI 文档", url: "https://fastapi.tiangolo.com", domains: ["fastapi.tiangolo.com"], topics: ["fastapi", "python", "api", "async", "pydantic"], description: "FastAPI 异步 Python 框架文档", searchPattern: "site:fastapi.tiangolo.com {query}" },
  { name: "Spring 文档", url: "https://spring.io/projects", domains: ["spring.io", "docs.spring.io"], topics: ["spring", "java", "spring-boot", "microservice", "backend"], description: "Spring 生态文档", searchPattern: "site:spring.io {query}" },
  { name: "Go 官方文档", url: "https://go.dev/doc", domains: ["go.dev", "pkg.go.dev"], topics: ["go", "golang", "concurrency", "goroutine", "backend"], description: "Go 语言官方文档和包文档", searchPattern: "site:go.dev {query}" },
  { name: "Rust Book", url: "https://doc.rust-lang.org", domains: ["doc.rust-lang.org"], topics: ["rust", "ownership", "borrow", "cargo", "systems-programming"], description: "Rust 语言官方文档", searchPattern: "site:doc.rust-lang.org {query}" },

  // === 数据库 ===
  { name: "PostgreSQL 文档", url: "https://www.postgresql.org/docs", domains: ["postgresql.org"], topics: ["postgresql", "postgres", "sql", "database", "rdbms", "relational"], description: "PostgreSQL 数据库官方文档", searchPattern: "site:postgresql.org {query}" },
  { name: "MongoDB 文档", url: "https://www.mongodb.com/docs", domains: ["mongodb.com", "docs.mongodb.com"], topics: ["mongodb", "nosql", "database", "document-store", "mongoose"], description: "MongoDB 文档数据库官方文档", searchPattern: "site:mongodb.com/docs {query}" },
  { name: "Redis 文档", url: "https://redis.io/docs", domains: ["redis.io"], topics: ["redis", "cache", "key-value", "pub-sub", "queue"], description: "Redis 内存数据库官方文档", searchPattern: "site:redis.io {query}" },
  { name: "SQLite 文档", url: "https://www.sqlite.org/docs.html", domains: ["sqlite.org"], topics: ["sqlite", "embedded-database", "sql", "local-db"], description: "SQLite 嵌入式数据库文档", searchPattern: "site:sqlite.org {query}" },

  // === DevOps & Cloud ===
  { name: "Docker 文档", url: "https://docs.docker.com", domains: ["docs.docker.com"], topics: ["docker", "container", "devops", "image", "compose", "swarm"], description: "Docker 容器平台官方文档", searchPattern: "site:docs.docker.com {query}" },
  { name: "Kubernetes 文档", url: "https://kubernetes.io/docs", domains: ["kubernetes.io"], topics: ["kubernetes", "k8s", "container-orchestration", "devops", "cloud-native"], description: "Kubernetes 编排平台官方文档", searchPattern: "site:kubernetes.io {query}" },
  { name: "AWS 文档", url: "https://docs.aws.amazon.com", domains: ["docs.aws.amazon.com", "aws.amazon.com"], topics: ["aws", "cloud", "lambda", "s3", "ec2", "cloud-computing"], description: "Amazon Web Services 云服务文档", searchPattern: "site:docs.aws.amazon.com {query}" },
  { name: "Cloudflare 文档", url: "https://developers.cloudflare.com", domains: ["developers.cloudflare.com"], topics: ["cloudflare", "cdn", "workers", "dns", "edge-computing", "serverless"], description: "Cloudflare 边缘计算平台文档", searchPattern: "site:developers.cloudflare.com {query}" },
  { name: "Vercel 文档", url: "https://vercel.com/docs", domains: ["vercel.com"], topics: ["vercel", "deployment", "serverless", "edge-functions", "hosting"], description: "Vercel 部署平台文档", searchPattern: "site:vercel.com/docs {query}" },
  { name: "GitHub Docs", url: "https://docs.github.com", domains: ["docs.github.com"], topics: ["github", "git", "ci-cd", "actions", "repository"], description: "GitHub 平台文档", searchPattern: "site:docs.github.com {query}" },

  // === AI & ML ===
  { name: "OpenAI API 文档", url: "https://platform.openai.com/docs", domains: ["platform.openai.com"], topics: ["openai", "gpt", "chatgpt", "ai", "llm", "api", "embedding"], description: "OpenAI API 和模型文档", searchPattern: "site:platform.openai.com {query}" },
  { name: "Anthropic 文档", url: "https://docs.anthropic.com", domains: ["docs.anthropic.com"], topics: ["anthropic", "claude", "ai", "llm", "api"], description: "Anthropic Claude API 文档", searchPattern: "site:docs.anthropic.com {query}" },
  { name: "Hugging Face 文档", url: "https://huggingface.co/docs", domains: ["huggingface.co"], topics: ["huggingface", "transformers", "model-hub", "ai", "nlp", "machine-learning"], description: "Hugging Face 模型和 Transformers 文档", searchPattern: "site:huggingface.co {query}" },
  { name: "LangChain 文档", url: "https://python.langchain.com/docs", domains: ["python.langchain.com", "js.langchain.com"], topics: ["langchain", "llm", "agent", "rag", "chain", "ai-framework"], description: "LangChain AI 应用开发框架文档", searchPattern: "site:python.langchain.com {query}" },
  { name: "PyTorch 文档", url: "https://pytorch.org/docs", domains: ["pytorch.org"], topics: ["pytorch", "deep-learning", "neural-network", "tensor", "gpu", "machine-learning"], description: "PyTorch 深度学习框架文档", searchPattern: "site:pytorch.org {query}" },

  // === 技术社区 & 博客 ===
  { name: "Stack Overflow", url: "https://stackoverflow.com", domains: ["stackoverflow.com"], topics: ["programming", "debugging", "q-a", "code-help", "error", "bug-fix"], description: "全球最大编程问答社区", searchPattern: "site:stackoverflow.com {query}" },
  { name: "Dev.to", url: "https://dev.to", domains: ["dev.to"], topics: ["developer-blog", "tutorial", "web-dev", "programming", "career"], description: "开发者社区博客平台", searchPattern: "site:dev.to {query}" },
  { name: "Medium (技术)", url: "https://medium.com", domains: ["medium.com"], topics: ["tech-blog", "tutorial", "opinion", "software-engineering"], description: "Medium 技术博客文章", searchPattern: "site:medium.com {query}" },
  { name: "Hacker News", url: "https://news.ycombinator.com", domains: ["news.ycombinator.com"], topics: ["tech-news", "startup", "programming", "industry"], description: "Y Combinator 技术新闻聚合", searchPattern: "site:news.ycombinator.com {query}" },

  // === 设计 & UI ===
  { name: "Figma 文档", url: "https://help.figma.com", domains: ["help.figma.com", "figma.com"], topics: ["figma", "design", "ui-design", "prototype", "design-tool"], description: "Figma 设计工具文档", searchPattern: "site:help.figma.com {query}" },

  // === 移动开发 ===
  { name: "Apple Developer", url: "https://developer.apple.com/documentation", domains: ["developer.apple.com"], topics: ["ios", "swift", "swiftui", "uikit", "apple", "macos", "iphone"], description: "Apple 开发者文档 (iOS/macOS/Swift)", searchPattern: "site:developer.apple.com {query}" },
  { name: "Android Developers", url: "https://developer.android.com", domains: ["developer.android.com"], topics: ["android", "kotlin", "jetpack", "mobile", "compose"], description: "Android 开发者文档", searchPattern: "site:developer.android.com {query}" },
  { name: "React Native 文档", url: "https://reactnative.dev/docs", domains: ["reactnative.dev"], topics: ["react-native", "mobile", "cross-platform", "ios", "android"], description: "React Native 跨平台移动开发文档", searchPattern: "site:reactnative.dev {query}" },
  { name: "Flutter 文档", url: "https://docs.flutter.dev", domains: ["docs.flutter.dev", "flutter.dev"], topics: ["flutter", "dart", "mobile", "cross-platform", "widget"], description: "Flutter 跨平台 UI 框架文档", searchPattern: "site:docs.flutter.dev {query}" },

  // === 数据科学 ===
  { name: "Pandas 文档", url: "https://pandas.pydata.org/docs", domains: ["pandas.pydata.org"], topics: ["pandas", "dataframe", "data-analysis", "python", "csv"], description: "Pandas 数据分析库文档", searchPattern: "site:pandas.pydata.org {query}" },
  { name: "NumPy 文档", url: "https://numpy.org/doc", domains: ["numpy.org"], topics: ["numpy", "array", "numerical", "scientific-computing", "python"], description: "NumPy 数值计算库文档", searchPattern: "site:numpy.org {query}" },

  // === SEO & Marketing ===
  { name: "Google Search Central", url: "https://developers.google.com/search", domains: ["developers.google.com/search"], topics: ["seo", "search-engine", "google-search", "indexing", "crawl"], description: "Google 搜索中心 SEO 文档", searchPattern: "site:developers.google.com/search {query}" },
  { name: "Moz Blog", url: "https://moz.com/blog", domains: ["moz.com"], topics: ["seo", "backlink", "domain-authority", "keyword", "ranking"], description: "Moz SEO 行业权威博客", searchPattern: "site:moz.com {query}" },
  { name: "Ahrefs Blog", url: "https://ahrefs.com/blog", domains: ["ahrefs.com"], topics: ["seo", "backlink", "keyword-research", "content-marketing"], description: "Ahrefs SEO 工具博客", searchPattern: "site:ahrefs.com {query}" },

  // === 安全 ===
  { name: "OWASP", url: "https://owasp.org", domains: ["owasp.org"], topics: ["security", "owasp", "vulnerability", "xss", "csrf", "injection"], description: "OWASP Web 安全最佳实践", searchPattern: "site:owasp.org {query}" },
]

export function findSitesByTopics(topics: string[]): SiteEntry[] {
  const topicLower = topics.map(t => t.toLowerCase())
  const scored = SITE_REGISTRY.map(site => {
    const matchCount = topicLower.filter(t =>
      site.topics.some(st => st.includes(t) || t.includes(st))
    ).length
    return { site, score: matchCount }
  }).filter(s => s.score > 0)
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 8).map(s => s.site)
}

export function findSitesByDomain(url: string): SiteEntry | undefined {
  try {
    const hostname = new URL(url).hostname.replace("www.", "")
    return SITE_REGISTRY.find(s => s.domains.some(d => hostname === d || hostname.endsWith("." + d)))
  } catch {
    return undefined
  }
}
