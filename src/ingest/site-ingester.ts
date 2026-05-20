/**
 * Site Ingester — 全站文档摄入引擎
 *
 * 策略链路（按优先级）:
 * 1. llms-full.txt / llms.txt（现代文档站标配）
 * 2. sitemap.xml（通用）
 * 3. VitePress __VP_HASH_MAP__ + sidebar（VitePress 站点）
 * 4. 首页链接发现（兜底）
 */

import { writeDoc } from "../storage/index.js"

// ─── Types ────────────────────────────────────────────────────────

export interface SiteIngestOptions {
  url: string               // 站点根 URL，如 https://hono.dev/docs
  maxPages?: number          // 最多抓取页数（默认 100）
  concurrency?: number       // 并发数（默认 5）
  tags?: string[]            // 自定义 tags
  projectName?: string       // 项目名（默认从域名提取）
}

export interface PageEntry {
  url: string
  title: string
  section: string            // 目录分区（如 "API", "Guides"）
  path: string               // URL 路径部分，如 /docs/api/routing
}

export interface IngestResult {
  totalPages: number
  successPages: number
  failedPages: number
  documents: Array<{ id: string; title: string; section: string }>
  strategy: string           // 使用的发现策略
  durationMs: number
}

export type ProgressCallback = (event: {
  phase: "discovering" | "fetching" | "storing" | "done"
  message: string
  current?: number
  total?: number
}) => void

// ─── Helpers ──────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "") } catch { return "unknown" }
}

function extractPath(url: string): string {
  try { return new URL(url).pathname } catch { return "/" }
}

function pathToSection(path: string): string {
  // /docs/api/routing → API
  // /docs/guides/rpc → Guides
  // /docs/getting-started/bun → Getting Started
  const parts = path.replace(/^\/+|\/+$/g, "").split("/")
  if (parts.length >= 3) {
    const section = parts[1]        // e.g. "api", "guides", "helpers"
    const sub = parts[2]            // e.g. "routing", "rpc", "builtin"
    return (section + "/" + sub).replace(/[/-]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
  }
  if (parts.length >= 2) {
    return parts[1].replace(/[/-]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
  }
  return "General"
}

function pathToTitle(path: string): string {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/")
  const last = parts[parts.length - 1] || "Index"
  return last.replace(/[/-]/g, " ").replace(/\b\w/g, c => c.toUpperCase())
}

async function fetchText(url: string, timeout = 15000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-SiteIngester/1.0)" },
    })
    clearTimeout(timer)
    if (!resp.ok) return null
    return await resp.text()
  } catch {
    return null
  }
}

/** Extract text content from HTML, preserving code blocks and headings */
function htmlToMarkdown(html: string): string {
  // Remove script/style/nav/footer
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    // Convert headings
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `# ${stripTags(c)}`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `## ${stripTags(c)}`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `### ${stripTags(c)}`)
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `#### ${stripTags(c)}`)
    // Convert code blocks
    .replace(/<pre[^>]*><code[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
      (_, lang, code) => `\n\`\`\`${lang}\n${decodeEntities(stripTags(code))}\n\`\`\`\n`)
    .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
      (_, code) => `\n\`\`\`\n${decodeEntities(stripTags(code))}\n\`\`\`\n`)
    // Convert inline code
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${stripTags(c)}\``)
    // Convert links
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${stripTags(text)}](${href})`)
    // Convert bold/italic
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, (_, __, c) => `**${stripTags(c)}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, (_, __, c) => `*${stripTags(c)}*`)
    // Convert list items
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${stripTags(c).trim()}`)
    // Convert table cells
    .replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi, (_, c) => `| ${stripTags(c).trim()} `)
    .replace(/<\/tr>/gi, "|\n")
    // Remove remaining tags
    .replace(/<[^>]+>/g, "")
    // Clean up whitespace
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return text
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "")
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
}

// ─── Discovery Strategies ─────────────────────────────────────────

/** Strategy 1: llms-full.txt / llms.txt */
async function discoverFromLlmsTxt(baseUrl: string, onProgress: ProgressCallback): Promise<PageEntry[] | null> {
  const origin = new URL(baseUrl).origin
  for (const path of ["/llms-full.txt", "/llms.txt"]) {
    const text = await fetchText(origin + path)
    if (!text || text.length < 100) continue

    onProgress({ phase: "discovering", message: `Found ${path} (${(text.length / 1024).toFixed(0)}KB)` })

    // llms-full.txt is one giant document — split by markdown headings
    // Each # or ## heading represents a page/section
    const sections = text.split(/\n(?=#{1,3} )/)
    const pages: PageEntry[] = []
    let currentPath = "/docs"

    for (const section of sections) {
      const headingMatch = section.match(/^#{1,3} (.+)/)
      if (!headingMatch) continue

      const title = headingMatch[1].trim().replace(/#+\s*$/, "").trim()
      if (!title || title.length < 2) continue

      // Generate a slug from the title
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      const sectionPath = `${currentPath}/${slug}`

      pages.push({
        url: origin + sectionPath,
        title,
        section: pathToSection(sectionPath),
        path: sectionPath,
      })

      // For large files, we also store the content directly
      // We'll handle this in the fetch step
    }

    // For llms.txt, we have the full content already — store as one big doc
    // plus individual sections
    if (pages.length > 0) {
      // Store the whole thing as the primary content source
      return pages.map(p => ({ ...p, _fullContent: text }))
    }
  }
  return null
}

/** Strategy 2: sitemap.xml */
async function discoverFromSitemap(baseUrl: string, onProgress: ProgressCallback): Promise<PageEntry[] | null> {
  const origin = new URL(baseUrl).origin
  const baseSite = new URL(baseUrl)

  // Try common sitemap locations
  for (const path of ["/sitemap.xml", "/sitemap-index.xml"]) {
    const text = await fetchText(origin + path)
    if (!text || !text.includes("<url") || !text.includes("<loc")) continue

    onProgress({ phase: "discovering", message: `Found sitemap at ${path}` })

    // Also check if it's a sitemap index
    if (text.includes("<sitemapindex")) {
      const subSitemaps = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])
      const allPages: PageEntry[] = []
      for (const subUrl of subSitemaps.slice(0, 10)) {
        const subText = await fetchText(subUrl)
        if (subText) {
          const pages = parseSitemapXml(subText, baseSite.pathname)
          allPages.push(...pages)
        }
      }
      return allPages.length > 0 ? allPages : null
    }

    const pages = parseSitemapXml(text, baseSite.pathname)
    return pages.length > 0 ? pages : null
  }

  // Check robots.txt
  const robots = await fetchText(origin + "/robots.txt")
  if (robots) {
    const sitemapMatch = robots.match(/Sitemap:\s*(.+)/i)
    if (sitemapMatch) {
      const sitemapUrl = sitemapMatch[1].trim()
      onProgress({ phase: "discovering", message: `Found sitemap from robots.txt: ${sitemapUrl}` })
      const text = await fetchText(sitemapUrl)
      if (text) {
        const pages = parseSitemapXml(text, baseSite.pathname)
        if (pages.length > 0) return pages
      }
    }
  }

  return null
}

function parseSitemapXml(xml: string, basePath: string): PageEntry[] {
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim())
  return urls
    .filter(url => {
      try {
        const u = new URL(url)
        return u.pathname.startsWith(basePath) || basePath === "/"
      } catch { return false }
    })
    .map(url => {
      const path = extractPath(url)
      return {
        url,
        title: pathToTitle(path),
        section: pathToSection(path),
        path,
      }
    })
}

/** Strategy 3: VitePress __VP_HASH_MAP__ + sidebar */
async function discoverFromVitePress(baseUrl: string, onProgress: ProgressCallback): Promise<PageEntry[] | null> {
  const text = await fetchText(baseUrl)
  if (!text) return null

  // Check for VitePress signature
  const vpMatch = text.match(/window\.__VP_SITE_DATA__\s*=\s*JSON\.parse\("(.+?)"\)/)
  if (!vpMatch) return null

  onProgress({ phase: "discovering", message: "Detected VitePress site, extracting sidebar structure" })

  try {
    // Unescape the JSON string
    const jsonStr = vpMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    const siteData = JSON.parse(jsonStr)
    const sidebar = siteData?.themeConfig?.sidebar
    if (!sidebar) return null

    const origin = new URL(baseUrl).origin
    const pages: PageEntry[] = []

    // Extract pages from sidebar structure
    for (const [, groups] of Object.entries(sidebar)) {
      const items = groups as Array<{ text: string; link: string; items?: Array<{ text: string; link: string }> }>
      for (const group of items) {
        if (group.link) {
          const url = origin + group.link
          pages.push({
            url,
            title: group.text,
            section: pathToSection(group.link),
            path: group.link,
          })
        }
        if (group.items) {
          for (const item of group.items) {
            if (item.link) {
              const url = origin + item.link
              pages.push({
                url,
                title: item.text,
                section: pathToSection(item.link),
                path: item.link,
              })
            }
          }
        }
      }
    }

    return pages.length > 0 ? pages : null
  } catch {
    return null
  }
}

/** Strategy 4: Link discovery from homepage */
async function discoverFromLinks(baseUrl: string, onProgress: ProgressCallback): Promise<PageEntry[]> {
  onProgress({ phase: "discovering", message: "Falling back to link discovery from homepage" })

  const text = await fetchText(baseUrl)
  if (!text) return []

  const origin = new URL(baseUrl).origin
  const basePath = new URL(baseUrl).pathname.replace(/\/[^/]*$/, "")
  const seen = new Set<string>()
  const links: PageEntry[] = []

  // Extract all <a href> links
  const hrefs = [...text.matchAll(/href="([^"]+)"/g)].map(m => m[1])
  for (const href of hrefs) {
    try {
      const fullUrl = href.startsWith("http") ? href : origin + (href.startsWith("/") ? href : "/" + href)
      const u = new URL(fullUrl)
      // Only include same-origin links under the base path
      if (u.hostname !== new URL(baseUrl).hostname) continue
      if (!u.pathname.startsWith(basePath) && basePath !== "/") continue
      // Skip anchors, files, etc
      if (u.pathname.match(/\.(png|jpg|svg|css|js|ico|xml|json|zip)$/i)) continue
      if (seen.has(u.pathname)) continue

      seen.add(u.pathname)
      links.push({
        url: fullUrl,
        title: pathToTitle(u.pathname),
        section: pathToSection(u.pathname),
        path: u.pathname,
      })
    } catch { /* skip invalid URLs */ }
  }

  return links
}

// ─── Main Entry Point ─────────────────────────────────────────────

export async function ingestSite(
  options: SiteIngestOptions,
  onProgress?: ProgressCallback,
): Promise<IngestResult> {
  const t0 = Date.now()
  const { url, maxPages = 100, concurrency = 5, tags = [], projectName } = options
  const domain = extractDomain(url)
  const project = projectName || domain.replace(/\./g, "-")
  const baseTags = ["reference", "site-ingested", ...tags]

  const progress = (event: Parameters<ProgressCallback>[0]) => {
    onProgress?.(event)
  }

  // ── Phase 1: Discover pages ──
  progress({ phase: "discovering", message: `Discovering pages from ${url}...` })

  let pages: PageEntry[] | null = null
  let strategy = ""

  // Strategy 1: llms-full.txt
  const llmsPages = await discoverFromLlmsTxt(url, progress)
  if (llmsPages && llmsPages.length > 0) {
    pages = llmsPages
    strategy = "llms-full.txt"
  }

  // Strategy 2: sitemap.xml
  if (!pages) {
    const sitemapPages = await discoverFromSitemap(url, progress)
    if (sitemapPages && sitemapPages.length > 0) {
      pages = sitemapPages
      strategy = "sitemap.xml"
    }
  }

  // Strategy 3: VitePress sidebar
  if (!pages) {
    const vpPages = await discoverFromVitePress(url, progress)
    if (vpPages && vpPages.length > 0) {
      pages = vpPages
      strategy = "vitepress-sidebar"
    }
  }

  // Strategy 4: Link discovery
  if (!pages) {
    pages = await discoverFromLinks(url, progress)
    strategy = "link-discovery"
  }

  if (!pages || pages.length === 0) {
    return {
      totalPages: 0, successPages: 0, failedPages: 0,
      documents: [], strategy: "none", durationMs: Date.now() - t0,
    }
  }

  // Deduplicate by path
  const seen = new Set<string>()
  pages = pages.filter(p => {
    if (seen.has(p.path)) return false
    seen.add(p.path)
    return true
  })

  // Limit pages
  if (pages.length > maxPages) {
    pages = pages.slice(0, maxPages)
  }

  progress({ phase: "discovering", message: `Found ${pages.length} pages via ${strategy}`, total: pages.length })

  // ── Phase 2: Fetch content ──
  progress({ phase: "fetching", message: `Fetching ${pages.length} pages...`, current: 0, total: pages.length })

  const fetched: Array<{ page: PageEntry; content: string }> = []
  let fetchedCount = 0

  // Process in batches
  for (let i = 0; i < pages.length; i += concurrency) {
    const batch = pages.slice(i, i + concurrency)
    const results = await Promise.allSettled(
      batch.map(async (page) => {
        // If we already have content from llms-full.txt, extract the section
        if ((page as any)._fullContent) {
          const fullContent = (page as any)._fullContent as string
          // Find the section matching this title
          const titleEscaped = page.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          const sectionRegex = new RegExp(`#{1,3} ${titleEscaped}[\\s\\S]*?(?=\\n#{1,3} |$)`, "i")
          const match = fullContent.match(sectionRegex)
          const content = match ? match[0].trim() : `# ${page.title}\n\nContent from full documentation.`
          return { page, content }
        }

        // Fetch the page
        const html = await fetchText(page.url)
        if (!html) return { page, content: "" }

        // Try to extract main content area
        const mainContent = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)
          || html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
          || html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
          || html.match(/<div[^>]*id="app"[^>]*>([\s\S]*)/i)

        const contentHtml = mainContent ? mainContent[1] : html
        const markdown = htmlToMarkdown(contentHtml)

        return { page, content: markdown }
      })
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.content.length > 50) {
        fetched.push(result.value)
      }
    }

    fetchedCount += batch.length
    progress({
      phase: "fetching",
      message: `Fetched ${fetchedCount}/${pages.length}`,
      current: fetchedCount,
      total: pages.length,
    })
  }

  // ── Phase 3: Store documents ──
  progress({ phase: "storing", message: `Storing ${fetched.length} documents...`, current: 0, total: fetched.length })

  const documents: IngestResult["documents"] = []

  for (let i = 0; i < fetched.length; i++) {
    const { page, content } = fetched[i]

    // Generate keywords from path segments + title
    const pathKeywords = page.path.split("/").filter(p => p.length > 1 && p !== "docs")
    const titleWords = page.title.split(/\s+/).filter(w => w.length > 2)
    const keywords = [...new Set([...pathKeywords.slice(0, 3), ...titleWords.slice(0, 4)])].slice(0, 8)

    try {
      const doc = writeDoc(
        {
          title: `${page.title} — ${domain}`,
          tags: [...baseTags, page.section.split("/")[0]?.toLowerCase() || "general"].filter(Boolean),
          keywords,
          intent: `Site-ingested from ${page.url}`,
          project_description: project,
          source_project: project,
          related_files: [page.url],
        },
        content.slice(0, 30000), // Cap at 30K chars per doc
      )
      documents.push({ id: doc.id, title: page.title, section: page.section })
    } catch (e) {
      console.warn(`[ingest-site] Failed to store ${page.url}:`, e instanceof Error ? e.message : String(e))
    }

    if (i % 10 === 0) {
      progress({ phase: "storing", message: `Stored ${i + 1}/${fetched.length}`, current: i + 1, total: fetched.length })
    }
  }

  // ── Phase 4: Generate outline doc ──
  if (documents.length > 0) {
    const sections = new Map<string, IngestResult["documents"]>()
    for (const doc of documents) {
      const sec = doc.section || "General"
      if (!sections.has(sec)) sections.set(sec, [])
      sections.get(sec)!.push(doc)
    }

    let outline = `# ${domain} Documentation Index\n\n`
    outline += `> Auto-generated site index from ${strategy}\n`
    outline += `> Source: ${url}\n`
    outline += `> Pages: ${documents.length}\n\n`

    for (const [section, docs] of sections) {
      outline += `## ${section}\n\n`
      for (const doc of docs) {
        outline += `- [${doc.title}](id:${doc.id})\n`
      }
      outline += "\n"
    }

    writeDoc(
      {
        title: `${domain} — Documentation Wiki Index`,
        tags: [...baseTags, "wiki-index"],
        keywords: [domain, "documentation", "index", "wiki"],
        intent: `Wiki index for ${domain} documentation site`,
        project_description: project,
        source_project: project,
      },
      outline,
    )
  }

  const durationMs = Date.now() - t0
  progress({
    phase: "done",
    message: `Done! ${documents.length}/${pages.length} pages ingested via ${strategy} in ${(durationMs / 1000).toFixed(1)}s`,
  })

  return {
    totalPages: pages.length,
    successPages: documents.length,
    failedPages: pages.length - documents.length,
    documents,
    strategy,
    durationMs,
  }
}
