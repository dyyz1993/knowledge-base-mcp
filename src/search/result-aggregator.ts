import type { SearchResult, SourceType } from "./types"
import { normalizeUrl } from "./utils"

function log(level: string, msg: string) {
  const ts = new Date().toISOString().substring(11, 19)
  console.log(`[${ts}] [aggregator] [${level}] ${msg}`)
}

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

function isSearchRedirect(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return (
      host.includes("baidu.com/link") ||
      host.includes("bing.com/ck/a") ||
      host.includes("google.com/url") ||
      host.includes("duckduckgo.com/l/")
    )
  } catch {
    return false
  }
}

function computeScore(result: SearchResult, query: string, crossSourceCount: number): number {
  // Penalize search engine redirect URLs
  if (isSearchRedirect(result.url)) return 10
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
  log("INFO", `Input: ${allResults.length} results | Query: "${query}"`)

  const byUrl = new Map<string, SearchResult>()
  const urlCount = new Map<string, number>()

  for (const r of allResults) {
    const key = normalizeUrl(r.url || r.title)
    const count = (urlCount.get(key) || 0) + 1
    urlCount.set(key, count)
    const existing = byUrl.get(key)
    if (!existing || r.snippet.length > existing.snippet.length) {
      byUrl.set(key, { ...r, sourceType: r.sourceType === "unknown" ? identifySourceType(r.url) : r.sourceType })
    }
  }

  const dupesRemoved = allResults.length - byUrl.size
  if (dupesRemoved > 0) {
    log("INFO", `Dedup: ${allResults.length} -> ${byUrl.size} (removed ${dupesRemoved} duplicates)`)
  }

  const crossSourceEntries = Array.from(urlCount.entries()).filter(([, c]) => c > 1)
  if (crossSourceEntries.length > 0) {
    log("DEBUG", `Cross-validated (${crossSourceEntries.length}): ${crossSourceEntries.map(([url, c]) => `${url.substring(0, 40)} x${c}`).join(", ")}`)
  }

  const scored = Array.from(byUrl.values()).map(r => ({
    ...r,
    qualityScore: computeScore(r, query, urlCount.get(r.url || r.title) || 1),
  }))

  scored.sort((a, b) => b.qualityScore - a.qualityScore)
  const top = scored.slice(0, maxResults)

  log("INFO", `Scored: top ${top.length} results`)
  for (const r of top) {
    log("DEBUG", `  [${r.qualityScore}pts] [${r.source}] [${r.sourceType}] ${r.title?.substring(0, 50)}`)
  }

  return top
}
