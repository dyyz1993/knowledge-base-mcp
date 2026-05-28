import { loadConfig } from "../config"
import { writeDoc, resolveMiss } from "../storage/index"
import { getMcpWebSearch } from "./mcp-web-search"
import { XBrowserCLI } from "./xbrowser-cli"
import { WebScraper, cleanContent as scraperCleanContent } from "./web-scraper.js"
import type { ScrapedPage } from "./web-scraper.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("search:source-discovery")

export interface DiscoveryResult {
  discovered_sources: Array<{
    url: string
    title: string
    authority_score: number
    is_data_page: boolean
  }>
  pages_read: number
  pages_success: number
  docs_saved: Array<{ id: string; title: string }>
  summary: string
}

const DATA_PAGE_PATTERNS = [
  /名单|名录|目录|大全|列表|清单|统计|一览|汇总|database|directory|list|catalog/i,
  /完整|全部|所有|详细|逐省|分[省市]|按[省市]/i,
  /一级|二级|三级|国家级|等级|评级|定级/i,
]

const ANNOUNCEMENT_PATTERNS = [
  /^关于.*的公告$/i,
]

const REDIRECT_URL_PATTERNS = [
  /baidu\.com\/link/i,
  /google\.com\/url/i,
  /bing\.com\/ck\/a/i,
]

async function resolveRedirects(url: string): Promise<string> {
  let isRedirect = false
  for (const p of REDIRECT_URL_PATTERNS) {
    if (p.test(url)) { isRedirect = true; break }
  }
  if (!isRedirect) return url

  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-SourceDiscovery/1.0)" },
    })
    const finalUrl = resp.url || resp.headers.get("location") || url
    return finalUrl
  } catch {
    logger.debug(`resolveRedirects failed for ${url}`)
    return ""
  }
}

export async function discoverAndIngest(
  query: string,
  options?: {
    maxSearchResults?: number
    maxDeepReads?: number
    autoSave?: boolean
    onStatus?: (status: string) => void
  },
): Promise<DiscoveryResult> {
  const maxSearch = options?.maxSearchResults ?? 10
  const maxReads = options?.maxDeepReads ?? 4
  const autoSave = options?.autoSave ?? true
  const onStatus = options?.onStatus

  const result: DiscoveryResult = {
    discovered_sources: [],
    pages_read: 0,
    pages_success: 0,
    docs_saved: [],
    summary: "",
  }

  onStatus?.("搜索权威数据源...")

  const searchResults = await discoverAuthoritativeSources(query, maxSearch)
  if (searchResults.length === 0) {
    result.summary = "未找到任何相关数据源"
    return result
  }

  const dataPages = searchResults.filter(r => r.isDataPage)
  const topSources = (dataPages.length > 0 ? dataPages : searchResults)
    .filter(r => r.authorityScore >= 5)
    .slice(0, maxReads)

  for (const r of searchResults) {
    result.discovered_sources.push({
      url: r.url,
      title: r.title,
      authority_score: r.authorityScore,
      is_data_page: r.isDataPage,
    })
  }

  onStatus?.(`发现 ${searchResults.length} 个数据源（${dataPages.length} 个数据页），抓取 top ${topSources.length}...`)

  const config = loadConfig()
  const xbrowserConfig = config.searchPipeline?.sources?.xbrowser
  const cdpEndpoint = xbrowserConfig?.cdpEndpoint
    ? xbrowserConfig.cdpEndpoint.replace(/^https?/, "http").replace(/\/devtools\/browser\/.*$/, "")
    : ""

  const allScrapedPages: ScrapedPage[] = []

  if (cdpEndpoint) {
    const scraper = new WebScraper({
      cdpEndpoint,
      headless: xbrowserConfig?.headless ?? true,
      timeout: 30000,
      maxPages: 3,
    })

    for (let i = 0; i < topSources.length; i++) {
      const source = topSources[i]
      result.pages_read++
      onStatus?.(`渲染抓取 ${result.pages_read}/${topSources.length}: ${source.title.slice(0, 30)}...`)

      try {
        const scrapeResult = await scraper.scrapePaginated(source.url)
        if (scrapeResult.pages.length > 0 && scrapeResult.pages[0].content.length > 50) {
          allScrapedPages.push(...scrapeResult.pages)
          result.pages_success++
        }
      } catch (e) {
        logger.debug(`WebScraper failed for ${source.url}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    try { await scraper.close() } catch { /* ignore */ }
  }

  if (result.pages_success === 0) {
    onStatus?.("渲染抓取失败，尝试 fetch fallback...")
    for (const source of topSources) {
      result.pages_read++
      const page = await fetchFallback(source.url)
      if (page) {
        allScrapedPages.push({ ...page, pageNumber: 1 })
        result.pages_success++
      }
    }
  }

  if (!autoSave || allScrapedPages.length === 0) {
    result.summary = result.pages_success > 0
      ? `抓取 ${result.pages_success} 个页面成功（未入库）`
      : "所有页面抓取失败"
    return result
  }

  onStatus?.("结构化入库...")

  for (const page of allScrapedPages) {
    if (page.content.length < 50) continue
    const doc = ingestPage(query, page)
    if (doc) result.docs_saved.push({ id: doc.id, title: doc.title })
  }

  resolveMiss(query)
  result.summary = `发现 ${searchResults.length} 个数据源（${dataPages.length} 个数据页），抓取 ${result.pages_success}/${result.pages_read} 页（${allScrapedPages.length} 页数据），入库 ${result.docs_saved.length} 篇文档`
  return result
}

interface AuthoritativeSource {
  url: string
  title: string
  snippet?: string
  authorityScore: number
  isDataPage: boolean
  source: string
}

async function discoverAuthoritativeSources(
  query: string,
  maxResults: number,
): Promise<AuthoritativeSource[]> {
  const config = loadConfig()
  const allSources = new Map<string, AuthoritativeSource>()

  const searchStrategies = [
    `${query} 完整名单 数据 列表`,
    `${query} wikipedia OR baike.baidu.com OR zhihu.com`,
    `${query} 官方 名录 gov.cn`,
    query,
  ]

  const xbrowserConfig = config.searchPipeline?.sources?.xbrowser
  if (xbrowserConfig?.enabled && xbrowserConfig.cdpEndpoint) {
    for (const strategy of searchStrategies) {
      try {
        const cli = new XBrowserCLI({
          enabled: true,
          engine: "baidu",
          cdpEndpoint: xbrowserConfig.cdpEndpoint,
          headless: xbrowserConfig.headless,
          timeout: 15000,
        })
        const results = await cli.search(strategy, maxResults)
        for (const r of results) {
          const resolvedUrl = await resolveRedirects(r.url)
          if (!resolvedUrl || isBlacklistedUrl(resolvedUrl)) continue
          r.url = resolvedUrl
          const key = normalizeUrl(resolvedUrl)
          if (!allSources.has(key)) {
            allSources.set(key, {
              ...scoreAndClassify(r.url, r.title, r.snippet),
              snippet: r.snippet,
              source: "xbrowser-google",
            })
          }
        }
      } catch (e) {
        logger.debug(`strategy "${strategy}" failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  const webSearch = getMcpWebSearch()
  if (webSearch?.searchAvailable) {
    for (const enQuery of [`${query} complete list directory`, `${query} data statistics`]) {
      try {
        const results = await webSearch.search(enQuery, maxResults)
        for (const r of results) {
          const rUrl = ("link" in r ? r.link : "") as string || ("url" in r ? (r as unknown as { url: string }).url : "")
          if (!rUrl || isBlacklistedUrl(rUrl)) continue
          const key = normalizeUrl(rUrl)
          if (!allSources.has(key)) {
            allSources.set(key, {
              ...scoreAndClassify(rUrl, r.title, r.content),
              source: "web-search-prime",
            })
          }
        }
      } catch (e) {
        logger.debug(`web-search-prime failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }

  return [...allSources.values()]
    .sort((a, b) => {
      if (a.isDataPage !== b.isDataPage) return a.isDataPage ? -1 : 1
      return b.authorityScore - a.authorityScore
    })
    .slice(0, maxResults)
}

function scoreAndClassify(url: string, title: string, snippet?: string): {
  url: string; title: string; authorityScore: number; isDataPage: boolean
} {
  let score = 3
  let isDataPage = false

  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const path = u.pathname.toLowerCase()
    const text = `${title} ${snippet || ""}`.toLowerCase()

    if (host.includes("wikipedia.org")) { score += 9; isDataPage = true }
    else if (host.includes("baike.baidu.com")) { score += 8; isDataPage = true }
    else if (host.includes("gov.cn")) { score += 8 }
    else if (host.endsWith(".edu.cn") || host.endsWith(".edu")) { score += 7 }
    else if (host.includes("museum") || host.includes("bwg")) { score += 6 }
    else if (host.includes("zhihu.com")) { score += 6 }
    else if (host.endsWith(".org")) { score += 4 }
    else if (host.endsWith(".com")) { score += 2 }

    if (/\/wiki\//i.test(path)) { score += 3; isDataPage = true }
    if (/\/list|\/data|\/catalog|\/directory|\/mlcx|\/minglu/i.test(path)) { score += 4; isDataPage = true }

    let dataSignalCount = 0
    for (const p of DATA_PAGE_PATTERNS) { if (p.test(text)) dataSignalCount++ }
    if (dataSignalCount >= 2) { score += 6; isDataPage = true }
    else if (dataSignalCount >= 1) { score += 3 }

    for (const p of ANNOUNCEMENT_PATTERNS) {
      if (p.test(title.trim())) { score -= 3; isDataPage = false; break }
    }

    if (/2024|2025|2026|最新|latest/i.test(text)) score += 2
    if (/\.pdf$/i.test(path)) score -= 2
  } catch {
    score = 1
  }

  return { url, title, authorityScore: Math.max(score, 0), isDataPage }
}

function isBlacklistedUrl(url: string): boolean {
  return /bing\.com\/ck\/a/i.test(url)
    || /google\.com\/(search|url)/i.test(url)
    || /baidu\.com\/link/i.test(url)
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, "").toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

async function fetchFallback(url: string): Promise<{ url: string; title: string; content: string } | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-SourceDiscovery/1.0)" },
      signal: AbortSignal.timeout(15000),
    })
    const html = await resp.text()
    const { extractHtmlContent } = await import("../http/helpers.js")
    const { title, content } = extractHtmlContent(html, url)
    const cleaned = scraperCleanContent(content)
    if (cleaned.length > 100) return { url, title: title || url, content: cleaned }
  } catch (e) {
    logger.debug(`fetch fallback failed for ${url}: ${e instanceof Error ? e.message : String(e)}`)
  }
  return null
}

function ingestPage(
  query: string,
  page: ScrapedPage,
) {
  try {
    const qWords = query.split(/[\s\-_—–,，、：:]+/).filter(w => w.length >= 2)
    const tWords = page.title.split(/[\s\-_—–,，、：:|（）()【】\[\]]+/).filter(w => w.length >= 2 && w.length < 20)
    const keywords = [...new Set([...qWords, ...tWords])].slice(0, 15)

    const truncatedContent = page.content.length > 50000
      ? page.content.slice(0, 50000) + `\n\n... (内容已截断，原文 ${page.content.length} 字符)`
      : page.content

    const finalContent = `${truncatedContent}\n\n## 数据来源\n- URL: ${page.url}\n- 页码: ${page.pageNumber}\n- 抓取时间: ${new Date().toISOString()}`

    const doc = writeDoc(
      {
        title: page.pageNumber > 1
          ? `${page.title} (第${page.pageNumber}页)`
          : page.title || `数据源: ${query}`,
        tags: ["reference", "web-ingested", "source-discovery"],
        keywords,
        intent: `source-discovery: ${query}`,
        project_description: "source-discovery auto-ingest",
        source_project: "",
        source_worktree: "",
        project_path: "",
        related_projects: [],
        related_files: [page.url],
      },
      finalContent,
    )
    return doc
  } catch (e) {
    logger.warn(`Failed to ingest page ${page.url}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
