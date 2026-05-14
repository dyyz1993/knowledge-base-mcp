import type { SearchResult, SourceType } from "./types"

const OFFICIAL_DOMAINS: Record<string, string[]> = {
  react: ["react.dev", "legacy.reactjs.org"],
  vue: ["vuejs.org", "v3.vuejs.org"],
  angular: ["angular.io", "angular.dev"],
  nodejs: ["nodejs.org", "nodejs.org/api"],
  python: ["python.org", "docs.python.org"],
  go: ["go.dev", "pkg.go.dev"],
  rust: ["rust-lang.org", "doc.rust-lang.org"],
  typescript: ["typescriptlang.org"],
  vercel: ["vercel.com", "ai-sdk.dev", "sdk.vercel.ai"],
  mdn: ["developer.mozilla.org"],
  github: ["github.com"],
}

function identifySourceType(url: string): SourceType {
  if (!url) return "unknown"
  try {
    const hostname = new URL(url).hostname.replace("www.", "")
    for (const domains of Object.values(OFFICIAL_DOMAINS)) {
      if (domains.some(d => hostname === d || hostname.endsWith("." + d))) {
        if (hostname.includes("docs") || hostname.includes("doc.")) return "documentation"
        return "official"
      }
    }
    const platforms = ["zhihu.com", "juejin.cn", "stackoverflow.com", "segmentfault.com", "cnblogs.com", "jianshu.com", "csdn.net"]
    if (platforms.some(p => hostname.endsWith(p))) return "platform"
    if (hostname.includes("github.com")) return "repository"
    return "blog"
  } catch {
    return "unknown"
  }
}

function computeScore(result: SearchResult, query: string, crossSourceCount: number): number {
  let score = 50
  switch (result.sourceType) {
    case "official": score += 30; break
    case "documentation": score += 20; break
    case "repository": score += 15; break
    case "platform": score += 10; break
    case "llm-knowledge": score += 5; break
  }
  score += Math.min(crossSourceCount * 5, 20)
  const qWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 1)
  const titleLower = result.title.toLowerCase()
  const snippetLower = result.snippet.toLowerCase()
  const matchCount = qWords.filter(w => titleLower.includes(w) || snippetLower.includes(w)).length
  score += Math.round((matchCount / Math.max(qWords.length, 1)) * 20)
  return Math.min(score, 100)
}

export function aggregateResults(
  allResults: SearchResult[],
  query: string,
  maxResults = 10,
): SearchResult[] {
  const byUrl = new Map<string, SearchResult>()
  const urlCount = new Map<string, number>()

  for (const r of allResults) {
    const key = r.url || r.title
    const count = (urlCount.get(key) || 0) + 1
    urlCount.set(key, count)
    const existing = byUrl.get(key)
    if (!existing || r.snippet.length > existing.snippet.length) {
      byUrl.set(key, { ...r, sourceType: r.sourceType === "unknown" ? identifySourceType(r.url) : r.sourceType })
    }
  }

  const scored = Array.from(byUrl.values()).map(r => ({
    ...r,
    qualityScore: computeScore(r, query, urlCount.get(r.url || r.title) || 1),
  }))

  scored.sort((a, b) => b.qualityScore - a.qualityScore)
  return scored.slice(0, maxResults)
}
