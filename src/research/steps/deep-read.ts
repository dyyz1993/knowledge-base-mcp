import type { DeepReadItem } from "../types"
import type { SearchResult } from "../../search/types"

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

    try {
      if (config.xbrowserEnabled) {
        const args = ["scrape", "--url", item.url, "--format", "json"]
        if (config.xbrowserCdp) {
          args.push("--cdp", config.xbrowserCdp)
        }
        if (config.xbrowserHeadless !== false) {
          args.push("--headless")
        }

        const proc = Bun.spawn(["xbrowser", ...args], {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env },
        })

        const timeout = setTimeout(() => {
          try { proc.kill() } catch {}
        }, 15000)

        const exitCode = await proc.exited
        clearTimeout(timeout)

        if (exitCode === 0) {
          const output = await new Response(proc.stdout).text()
          const parsed = JSON.parse(output)
          if (parsed?.content) {
            return {
              title: parsed.title || item.title,
              url: item.url,
              content: parsed.content,
              success: true,
              source: "xbrowser",
            }
          }
        }
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 15000)

      const resp = await fetch(item.url, {
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
          url: item.url,
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
