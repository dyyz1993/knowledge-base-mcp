import type { DeepReadItem } from "../types"
import type { SearchResult } from "../../search/types"

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

const deepReadCache = new Map<string, DeepReadItem>()

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
        const args = ["scrape", fetchItem.url, "--json"]
        if (config.xbrowserCdp) {
          args.push("--cdp", config.xbrowserCdp)
        }
        if (config.xbrowserHeadless !== false) {
          args.push("--headless")
        }

        const xbrowserBin = process.env.XBROWSER_PATH || "xbrowser"
        const proc = Bun.spawn([xbrowserBin, ...args], {
          stdout: "pipe",
          stderr: "ignore",
          env: { ...process.env },
        })

        const timeout = setTimeout(() => {
          try { proc.kill() } catch {}
        }, 15000)

        const exitCode = await proc.exited
        clearTimeout(timeout)

        if (exitCode === 0) {
          const output = await new Response(proc.stdout).text()
          const jsonMatch = output.match(/\{[\s\S]*"success"[\s\S]*\}/)
          if (!jsonMatch) return { ...base }
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(jsonMatch[0])
          } catch {
            return { ...base }
          }
          const data = parsed?.data as Record<string, unknown> | undefined
          const content = data?.content || parsed?.content || ""
          if (content && String(content).length > 50) {
            const result: DeepReadItem = {
              title: (data?.title as string) || fetchItem.title,
              url: fetchItem.url,
              content: String(content),
              success: true,
              source: "xbrowser",
            }
            deepReadCache.set(cacheKey, result)
            return result
          }
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

      const bodyContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20000)

      if (bodyContent.length > 50) {
        const result: DeepReadItem = {
          title,
          url: resp.url || fetchItem.url,
          content: bodyContent,
          success: true,
          source: "fetch",
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
    `https://web.archive.org/web/2024/${url}`,
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
