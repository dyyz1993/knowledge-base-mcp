import type { SitemapCheck } from "../types"
import type { SearchResult } from "../../search/types"

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

  for (const site of candidates.slice(0, 8)) {
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
          validSites.push({ base: cleanBase, sitemapUrl })
          break
        }
      } catch (e) { console.warn("[check-sitemap]", e instanceof Error ? e.message : String(e)); continue }
    }
  }

  if (validSites.length === 0) {
    return { isDocSite: false, sitemapUrl: null, relevantPaths: [], priority: [] }
  }

  const allPaths: string[] = []

  // Try up to 3 valid sitemap sites, not just the first one
  for (const site of validSites.slice(0, 3)) {
    try {
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
        } catch { continue }
      }
      if (sitePaths.length > 0) {
        allPaths.push(...sitePaths)
        break // Got paths from this sitemap, no need to try others
      }
    } catch {
      continue // Try next valid site
    }
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
    sitemapUrl: best.sitemapUrl,
    relevantPaths,
    priority,
  }
}
