import type { SitemapCheck } from "../types"
import type { SearchResult } from "../../search/types"
import { createLogger } from "../../utils/logger.js"
const logger = createLogger("research:steps:check-sitemap")

export async function checkSitemap(
  hints: string[],
  searchResults: SearchResult[],
  query: string,
): Promise<SitemapCheck> {
  const candidates = [...hints]

  for (const r of searchResults) {
    const url = new URL(r.url)
    const host = url.hostname
    const path = url.pathname
    if (
      path.includes("/docs") ||
      path.includes("/guide") ||
      path.includes("/tutorial") ||
      path.includes("/api/") ||
      host.includes("docs.") ||
      url.pathname === "/" ||
      url.pathname.endsWith("/docs")
    ) {
      const base = `${url.protocol}//${host}`
      if (!candidates.includes(base)) candidates.push(base)
    }
  }

  const validSites: Array<{ base: string; sitemapUrl: string }> = []

  // Probe sitemaps in parallel batches (4 concurrent) for speed
  const candidateList = candidates.slice(0, 8)
  const BATCH = 4
  for (let bi = 0; bi < candidateList.length; bi += BATCH) {
    const batch = candidateList.slice(bi, bi + BATCH)
    const probeResults = await Promise.allSettled(
      batch.map(async (site) => {
        let cleanBase: string
        try {
          const u = new URL(site)
          cleanBase = `${u.protocol}//${u.host}`
        } catch {
          cleanBase = site.replace(/\/+$/, "")
        }
        for (const sitemapPath of ["/sitemap.xml", "/sitemap-index.xml", "/docs/sitemap.xml"]) {
          const sitemapUrl = `${cleanBase}${sitemapPath}`
          try {
            const resp = await fetch(sitemapUrl, {
              method: "HEAD",
              headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
              signal: AbortSignal.timeout(5000),
            })
            if (resp.ok && (resp.headers.get("content-type")?.includes("xml") || resp.url.endsWith(".xml"))) {
              return { base: cleanBase, sitemapUrl }
            }
          } catch { logger.debug("Sitemap HEAD probe failed", { site, sitemapPath }); continue }
        }
      }),
    )
    for (const r of probeResults) {
      if (r.status === "fulfilled" && r.value) {
        validSites.push(r.value)
      }
    }
  }

  if (validSites.length === 0) {
    return { isDocSite: false, sitemapUrl: null, relevantPaths: [], priority: [] }
  }

  const allPaths: string[] = []
  const allSitePaths: Array<{ base: string; paths: string[] }> = []

  // Try up to 3 valid sitemap sites in parallel, collect paths from all
  const sitemapResults = await Promise.allSettled(
    validSites.slice(0, 3).map(async (site) => {
      const resp = await fetch(site.sitemapUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
        signal: AbortSignal.timeout(10000),
      })
      const xml = await resp.text()
      const urlMatches = xml.matchAll(/<loc>\s*(.*?)\s*<\/loc>/gi)
      const sitePaths: string[] = []
      for (const m of urlMatches) {
        const loc = m[1]
        try {
          const u = new URL(loc)
          if (u.hostname === new URL(site.base).hostname) {
            sitePaths.push(u.pathname)
          }
        } catch { logger.debug("URL parse failed for sitemap loc"); continue }
      }
      return sitePaths.length > 0 ? { base: site.base, paths: sitePaths } : null
    })
  )
  for (const r of sitemapResults) {
    if (r.status === "fulfilled" && r.value) {
      allSitePaths.push(r.value)
    } else if (r.status === "rejected") {
      logger.warn("Sitemap fetch/parse failed", { error: String(r.reason) })
    }
  }

  // Prefer official/authoritative domains: sort by path relevance and domain authority
  // Heuristic: domains matching query keywords are prioritized
  const queryTerms = query.toLowerCase().split(/[\s,，、]+/).filter(w => w.length > 2)
  const domainScores = allSitePaths.map(sp => {
    let score = 0
    try {
      const host = new URL(sp.base).hostname.toLowerCase()
      // Penalize known aggregator/mirror domains
      const AGGREGATOR_PATTERNS = ["docsmith", "aigne", "wikiless", "archive", "mirror", "proxy"]
      for (const p of AGGREGATOR_PATTERNS) {
        if (host.includes(p)) score -= 20
      }
      // Boost if domain matches query keywords
      for (const kw of queryTerms) {
        if (host.includes(kw)) score += 10
      }
      // Boost short domains (official projects tend to have short domains)
      score -= host.split(".").length // hono.dev = 2 parts, docsmith.aigne.io = 3 parts
    } catch (e) { logger.debug('Sitemap domain scoring failed:', e) }
    return { base: sp.base, paths: sp.paths, score }
  }).sort((a, b) => b.score - a.score)

  // Collect paths from highest-scoring sites first
  for (const ds of domainScores) {
    allPaths.push(...ds.paths)
  }

  if (allPaths.length === 0) {
    return { isDocSite: true, sitemapUrl: validSites[0].sitemapUrl, relevantPaths: [], priority: [] }
  }

  const uniquePaths = [...new Set(allPaths)]

  const keywords = query.toLowerCase().split(/[\s,，、]+/).filter(w => w.length > 1)
  const scored = uniquePaths.map(path => {
    const lower = path.toLowerCase()
    let score = 0
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 2
    }
    if (/\/docs\//.test(path)) score += 3
    if (/\/api\//.test(path)) score += 2
    if (/\/guide\//.test(path)) score += 2
    if (/\/tutorial\//.test(path)) score += 1
    if (/\/getting-started/.test(path)) score += 3
    if (/\/overview/.test(path)) score += 2
    if (/\/introduction/.test(path)) score += 2
    if (/\/changelog/.test(path) || /\/blog\//.test(path)) score -= 1
    if (/\.(png|jpg|svg|pdf|zip)$/i.test(path)) return { path, score: -100 }
    return { path, score }
  })
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)

  const priority = scored.slice(0, 5).map(s => s.path)
  const relevantPaths = scored.slice(0, 30).map(s => s.path)

  return {
    isDocSite: relevantPaths.length > 0,
    sitemapUrl: validSites[0].sitemapUrl,
    relevantPaths,
    priority,
  }
}
