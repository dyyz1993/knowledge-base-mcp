import type { DeepReadItem } from "../types"
import type { SearchResult } from "../../search/types"

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
}

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "ref", "source", "fbclid", "gclid",
])

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    u.hostname = u.hostname.toLowerCase()
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        u.searchParams.delete(key)
      }
    }
    let normalized = u.toString()
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  } catch {
    return url.toLowerCase().replace(/\/+$/, "")
  }
}

const MAX_CACHE_SIZE = 100

class LRUCache<T> {
  private map = new Map<string, { value: T; ts: number }>()

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    // Refresh access time
    entry.ts = Date.now()
    return entry.value
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      const entry = this.map.get(key)!
      entry.value = value
      entry.ts = Date.now()
      return
    }
    // Evict oldest if at capacity
    if (this.map.size >= MAX_CACHE_SIZE) {
      let oldestKey: string | null = null
      let oldestTs = Infinity
      for (const [k, v] of this.map) {
        if (v.ts < oldestTs) {
          oldestTs = v.ts
          oldestKey = k
        }
      }
      if (oldestKey) this.map.delete(oldestKey)
    }
    this.map.set(key, { value, ts: Date.now() })
  }

  clear(): void {
    this.map.clear()
  }
}

const deepReadCache = new LRUCache<DeepReadItem>()

export function clearDeepReadCache(): void {
  deepReadCache.clear()
}

const SEARCH_ENGINE_REDIRECT_PATTERNS = [
  /^https?:\/\/www\.baidu\.com\/link\?/i,
  /^https?:\/\/www\.bing\.com\/.*\/search/i,
  /^https?:\/\/www\.google\.com\/url\?/i,
  /^https?:\/\/duckduckgo\.com\/l\?/i,
]

function isSearchEngineRedirect(url: string): boolean {
  return SEARCH_ENGINE_REDIRECT_PATTERNS.some((p) => p.test(url))
}

async function resolveRedirect(url: string): Promise<string> {
  if (!isSearchEngineRedirect(url)) return url
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
      signal: AbortSignal.timeout(5000),
    })
    return resp.url || url
  } catch {
    return url
  }
}

export async function deepReadUrls(
  results: SearchResult[],
  config: {
    xbrowserEnabled: boolean
    xbrowserCdp?: string
    xbrowserHeadless?: boolean
    webReaderAvailable?: boolean
  },
): Promise<DeepReadItem[]> {
  const cachedItems: DeepReadItem[] = []
  const toFetch: { result: SearchResult; cacheKey: string }[] = []

  for (const r of results) {
    const key = normalizeUrl(r.url)
    const cached = deepReadCache.get(key)
    if (cached) {
      cachedItems.push(cached)
    } else {
      toFetch.push({ result: r, cacheKey: key })
    }
  }

  if (toFetch.length === 0) return cachedItems

  const readPromises = toFetch.map(async ({ result: item, cacheKey }) => {
    const base: DeepReadItem = {
      title: item.title,
      url: item.url,
      content: "",
      success: false,
      source: "failed",
    }

    let fetchItem = item
    if (isSearchEngineRedirect(item.url)) {
      const resolved = await resolveRedirect(item.url)
      if (resolved === item.url) return base
      fetchItem = { ...item, url: resolved }
    }

    try {
      if (config.xbrowserEnabled) {
        try {
          const { XBrowserCLI } = await import("../../search/xbrowser-cli.js")
          const cli = new XBrowserCLI({
            enabled: true,
            engine: "google",
            cdpEndpoint: config.xbrowserCdp || "",
            headless: config.xbrowserHeadless !== false,
            timeout: 15000,
          })
          const scrapeResult = await cli.scrape(fetchItem.url, "markdown")
          if (scrapeResult && scrapeResult.content && scrapeResult.content.length > 50) {
            const result: DeepReadItem = {
              title: scrapeResult.title || fetchItem.title,
              url: fetchItem.url,
              content: scrapeResult.content,
              success: true,
              source: "xbrowser",
            }
            deepReadCache.set(cacheKey, result)
            return result
          }
        } catch (e) {
          console.log(`[deep-read] xbrowser scrape failed for ${fetchItem.url}: ${e instanceof Error ? e.message : e}`)
        }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const resp = await fetch(fetchItem.url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const html = await resp.text()
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1].trim() : fetchItem.title

      // Preserve code blocks before stripping HTML tags
      let processed = html
      // <pre><code class="language-xxx"> → ```xxx\n...\n```
      processed = processed.replace(
        /<pre[^>]*><code[^>]*class="(?:language-|lang-)(\w+)"[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
        (_, lang, code) => `\n\`\`\`${lang}\n${decodeHtmlEntities(code)}\n\`\`\`\n`,
      )
      // <pre><code> → ```\n...\n```
      processed = processed.replace(
        /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
        (_, code) => `\n\`\`\`\n${decodeHtmlEntities(code)}\n\`\`\`\n`,
      )
      // <pre> → ```\n...\n```
      processed = processed.replace(
        /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
        (_, code) => `\n\`\`\`\n${code.replace(/<[^>]+>/g, "")}\n\`\`\`\n`,
      )
      // <code> → `inline code`
      processed = processed.replace(
        /<code[^>]*>([\s\S]*?)<\/code>/gi,
        (_, code) => `\`${code.replace(/<[^>]+>/g, "")}\``,
      )

      const bodyContent = processed
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20000)

      if (bodyContent.length > 50) {
        // Quality check: detect if content is mostly navigation/chrome
        const meaningfulContent = bodyContent
          .replace(/\b(Home|About|Contact|Login|Sign up|Menu|Navigation|Cookie|Privacy|Terms|Copyright)\b/gi, "")
          .replace(/\s+/g, " ")
          .trim()
        const isLikelyNavigation = meaningfulContent.length < 300

        const result: DeepReadItem = {
          title,
          url: resp.url || fetchItem.url,
          content: isLikelyNavigation ? "" : bodyContent,
          success: !isLikelyNavigation,
          source: isLikelyNavigation ? "failed" : "fetch",
        }
        if (isLikelyNavigation) {
          console.log(`[deep-read] Content appears to be navigation/chrome for ${fetchItem.url}, marking as failed`)
        }
        deepReadCache.set(cacheKey, result)
        return result
      }

      return base
    } catch {
      return base
    }
  })

  const settled = await Promise.all(readPromises)

  const retried = settled.map(async (item, idx) => {
    if (item.success) return item
    const original = toFetch[idx].result
    const key = toFetch[idx].cacheKey
    const cached = await tryCacheFallback(original.url, original.title)
    if (cached) {
      deepReadCache.set(key, cached)
      return cached
    }
    return item
  })

  const fetched = await Promise.all(retried)
  return [...cachedItems, ...fetched]
}

const ANTI_CRAWL_DOMAINS = [
  "juejin.cn", "zhihu.com", "reddit.com", "stackoverflow.com",
  "segmentfault.com", "medium.com", "dev.to",
]

function needsCacheFallback(url: string): boolean {
  return ANTI_CRAWL_DOMAINS.some(d => url.includes(d))
}

async function tryCacheFallback(url: string, fallbackTitle: string): Promise<DeepReadItem | null> {
  if (!needsCacheFallback(url)) return null

  const cacheUrls = [
    `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`,
    `https://web.archive.org/web/${new Date().getFullYear()}/${url}`,
  ]

  for (const cacheUrl of cacheUrls) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const resp = await fetch(cacheUrl, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (!resp.ok) continue

      const html = await resp.text()
      const bodyContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20000)

      if (bodyContent.length > 200) {
        return {
          title: fallbackTitle,
          url,
          content: bodyContent,
          success: true,
          source: "cache",
        }
      }
    } catch {
      continue
    }
  }

  return null
}
