import type { OpenAITool } from "./types.js"
import { launchBrowserForScrape, cleanupBrowser } from "../browser-launcher.js"
import { loadConfig } from "../../config.js"
import { stripHtmlTags } from "./helpers.js"
import { createLogger } from "../../utils/logger.js"

const logger = createLogger("chat:browser-tools")

export const browserToolDefs: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "browser_scrape",
      description: "用浏览器抓取页面内容（支持 SPA/JS 渲染页面）。比 url_fetch 更强大，能处理 Vue/React 等单页应用。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "目标 URL" },
          format: { type: "string", description: "输出格式: markdown|html|text (默认 markdown)" },
          selector: { type: "string", description: "等待指定 CSS 选择器出现后再抓取" },
          timeout: { type: "number", description: "超时毫秒 (默认 15000)" },
          max_length: { type: "number", description: "返回内容最大字符数（默认 10000）" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_map",
      description: "发现网站的所有 URL 链接。返回站点地图。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "目标网站 URL" },
          search: { type: "string", description: "只返回包含此字符串的 URL" },
          limit: { type: "number", description: "最大返回数量 (默认 100)" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "browser_crawl",
      description: "爬取网站多个页面（广度优先）。适合文档站、博客等结构化站点。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "起始 URL" },
          limit: { type: "number", description: "最大爬取页数 (默认 10)" },
          max_depth: { type: "number", description: "最大深度 (默认 2)" },
          include_paths: { type: "string", description: "只爬包含这些路径的页面 (如 /docs/)" },
          max_length: { type: "number", description: "总内容最大字符数 (默认 30000)" },
        },
        required: ["url"],
      },
    },
  },
]

export async function executeBrowserTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "browser_scrape": {
      const { url, format = "markdown", selector, max_length = 10000 } = args as { url: string; format?: string; selector?: string; timeout?: number; max_length?: number }
      const config = loadConfig()
      const timeout = Number(args.timeout) || config.browser.defaultTimeout

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return "URL 必须以 http:// 或 https:// 开头"
      }

      try {
        const { session } = await launchBrowserForScrape(url)
        const page = session.page

        if (selector) {
          await page.waitForSelector(selector, { timeout })
        }

        let content: string
        if (format === "html") {
          content = await page.content()
        } else if (format === "text") {
          content = await page.innerText("body")
        } else {
          const html = await page.content()
          content = stripHtmlTags(html)
        }

        return content.slice(0, max_length) || "(无内容)"
      } catch (e: unknown) {
        return `浏览器抓取失败: ${e instanceof Error ? e.message : String(e)}`
      } finally {
        await cleanupBrowser()
      }
    }
    case "browser_map": {
      const { url, search, limit = 100 } = args as { url: string; search?: string; limit?: number }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return "URL 必须以 http:// 或 https:// 开头"
      }

      try {
        const { session } = await launchBrowserForScrape(url)
        const page = session.page

        const links: string[] = await page.evaluate(() =>
          Array.from(document.querySelectorAll("a[href]")).map(a => (a as HTMLAnchorElement).href)
        )

        let baseHost = ""
        try { baseHost = new URL(url).hostname } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }

        const filtered = [...new Set(links)]
          .filter(link => {
            try {
              const u = new URL(link, url)
              return u.hostname === baseHost || u.hostname.endsWith(`.${baseHost}`)
            } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)); return false }
          })
          .filter(link => !search || link.includes(search))
          .slice(0, limit)

        return JSON.stringify(filtered, null, 2)
      } catch (e: unknown) {
        return `浏览器站点地图失败: ${e instanceof Error ? e.message : String(e)}`
      } finally {
        await cleanupBrowser()
      }
    }
    case "browser_crawl": {
      const { url, limit = 10, max_depth = 2, include_paths, max_length = 30000 } = args as {
        url: string; limit?: number; max_depth?: number; include_paths?: string; max_length?: number
      }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return "URL 必须以 http:// 或 https:// 开头"
      }

      let baseHost = ""
      try { baseHost = new URL(url).hostname } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }

      const visited = new Set<string>()
      const results: string[] = []
      const queue: { url: string; depth: number }[] = [{ url, depth: 0 }]

      let browserSession: Awaited<ReturnType<typeof launchBrowserForScrape>> | null = null
      try {
        while (queue.length > 0 && results.length < limit) {
          const item = queue.shift()!
          if (visited.has(item.url) || item.depth > max_depth) continue
          visited.add(item.url)

          if (include_paths && !item.url.includes(include_paths)) continue

          let content: string
          let links: string[] = []
          try {
            if (!browserSession) {
              browserSession = await launchBrowserForScrape(item.url)
            }
            const page = browserSession.session.page
            await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 15000 })

            const html = await page.content()
            content = stripHtmlTags(html)

            links = await page.evaluate(() =>
              Array.from(document.querySelectorAll("a[href]")).map(a => (a as HTMLAnchorElement).href)
            )
          } catch (e: unknown) {
            content = `(抓取失败: ${e instanceof Error ? e.message : String(e)})`
          }

          results.push(`## Page: ${item.url}\n${content}\n`)

          for (const link of links) {
            try {
              const u = new URL(link, url)
              if ((u.hostname === baseHost || u.hostname.endsWith(`.${baseHost}`)) && !visited.has(u.href)) {
                queue.push({ url: u.href, depth: item.depth + 1 })
              }
            } catch (e) { logger.warn(e instanceof Error ? e.message : String(e)) }
          }
        }
      } catch (e: unknown) {
        results.push(`\n爬取中断: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        if (browserSession) await cleanupBrowser()
      }

      const combined = results.join("\n")
      return combined.slice(0, max_length)
    }
    default:
      return undefined as never
  }
}
