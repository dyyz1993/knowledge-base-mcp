import type { DeepReadItem } from "../types"
import type { SearchResult } from "../../search/types"

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
  const readPromises = results.map(async (item) => {
    const base: DeepReadItem = {
      title: item.title,
      url: item.url,
      content: "",
      success: false,
      source: "failed",
    }

    if (isSearchEngineRedirect(item.url)) {
      const resolved = await resolveRedirect(item.url)
      if (resolved === item.url) return base
      item = { ...item, url: resolved }
    }

    try {
      if (config.xbrowserEnabled) {
        const args = ["scrape", item.url, "--json"]
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
            return {
              title: (data?.title as string) || item.title,
              url: item.url,
              content: String(content),
              success: true,
              source: "xbrowser",
            }
          }
        }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const resp = await fetch(item.url, {
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; KB-MCP/1.0)" },
        signal: controller.signal,
      })
      clearTimeout(timeout)

      const html = await resp.text()
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
      const title = titleMatch ? titleMatch[1].trim() : item.title

      const bodyContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20000)

      if (bodyContent.length > 50) {
        return {
          title,
          url: resp.url || item.url,
          content: bodyContent,
          success: true,
          source: "fetch",
        }
      }

      return base
    } catch {
      return base
    }
  })

  return Promise.all(readPromises)
}
