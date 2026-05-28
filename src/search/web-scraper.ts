import { createLogger } from "../utils/logger.js"
import { resolve, join } from "node:path"

const logger = createLogger("search:web-scraper")

function getXBrowserBin(): string {
  try {
    const local = resolve(process.cwd(), "node_modules", ".bin", "xbrowser")
    return local
  } catch {
    return "xbrowser"
  }
}

const XBR_BIN = getXBrowserBin()

export interface ScraperOptions {
  cdpEndpoint: string
  headless?: boolean
  timeout?: number
  maxPages?: number
  encoding?: string
}

export interface ScrapedPage {
  url: string
  title: string
  content: string
  rawContent?: string
  pageNumber: number
  links?: string[]
}

export interface ScrapeResult {
  pages: ScrapedPage[]
  totalPages: number
  hasMore: boolean
  title: string
}

export interface CleanConfig {
  removeNavigation?: boolean
  removeFooter?: boolean
  removeSidebar?: boolean
  removeAds?: boolean
  removeCookie?: boolean
  minLineLength?: number
}

const DEFAULT_CLEAN_CONFIG: Required<CleanConfig> = {
  removeNavigation: true,
  removeFooter: true,
  removeSidebar: true,
  removeAds: true,
  removeCookie: true,
  minLineLength: 2,
}

const NAVIGATION_PATTERNS = [
  /^[\s]*首页\s*[>›»]/,
  /^[\s]*首页\s*\/\s*/,
  /^[\s]*网站地图/,
  /^[\s]*面包屑/,
  /^[\s]*当前位置\s*[:：]/,
  /^[\s]*您所在的位置/,
  /^[\s]*导航$/,
  /^[\s]*(主页|首页|Home)\s*(>|›|»|\/)/,
  /^\s*\w+\s*(>|›|»)\s*\w+/,
]

const FOOTER_PATTERNS = [
  /版权所有/i,
  /©\s*\d{4}/,
  /All\s+Rights\s+Reserved/i,
  /ICP[备证]\d+/,
  /公网安备/,
  /公安备/,
  /备案号/,
  /^[\s]*技术支持[:：]/,
  /^[\s]*Powered\s+by/i,
  /^[\s]*Copyright/i,
  /^[\s]*\d{4}-\d{4}\s+©/,
  /^[\s]*关于我们$/,
  /^[\s]*联系我们$/,
  /^[\s]*友情链接[:：]/,
  /^[\s]*友情链接$/,
]

const COOKIE_PATTERNS = [
  /cookie\s*(policy|政策|设置|偏好)/i,
  /我们使用\s*(cookie|Cookie)/,
  /本网站使用\s*(cookie|Cookie)/,
  /接受\s*(所有|全部)\s*(cookie|Cookie)/i,
  /Accept\s+(all\s+)?cookies/i,
  /This\s+site\s+uses\s+cookies/i,
  /继续浏览.*cookie/i,
  /关闭.*cookie.*提示/i,
]

const AD_PATTERNS = [
  /^[\s]*广告$/,
  /^[\s]*AD\b/i,
  /^[\s]*赞助/,
  /^[\s]*Sponsored/i,
  /^[\s]*推广链接/,
  /^[\s]*相关推荐$/,
  /^[\s]*猜你喜欢$/,
  /^[\s]*热门推荐$/,
  /doubleclick|adsense|googleads/i,
]

const SHARE_PATTERNS = [
  /^[\s]*(微信|微博|QQ空间|QQ|豆瓣|人人|开心|Facebook|Twitter|LinkedIn|Pinterest|WhatsApp|Telegram)\s*(分享|share)?$/i,
  /^[\s]*分享到[:：]?$/,
  /^[\s]*Share\s+(this|on)/i,
  /^[\s]*分享$/,
]

const META_PATTERNS = [
  /^[\s]*(编辑|记者|作者|责编|撰稿)\s*[:：]/,
  /^[\s]*(来源|出处)\s*[:：]/,
  /^[\s]*(浏览|阅读|点击)(次数|量)\s*[:：]/,
  /^[\s]*发布时间\s*[:：]/,
  /^[\s]*更新时间\s*[:：]/,
  /^[\s]*\d{4}[-/]\d{1,2}[-/]\d{1,2}\s*\d{0,2}:?\d{0,2}$/,
  /^[\s]*\d{4}年\d{1,2}月\d{1,2}日/,
]

const SIDEBAR_PATTERNS = [
  /^[\s]*(热门|最新|推荐)(文章|新闻|帖子)/,
  /^[\s]*相关文章$/,
  /^[\s]*最新评论$/,
  /^[\s]*标签云$/,
  /^[\s]*(标签|Keywords)\s*[:：]/,
  /^[\s]*分类$/,
  /^[\s]*归档$/,
  /^[\s]*(Side|Sidebar)/i,
]

export function cleanContent(text: string, config?: CleanConfig): string {
  const cfg = { ...DEFAULT_CLEAN_CONFIG, ...config }
  const lines = text.split("\n")
  const cleaned: string[] = []
  let inFooter = false
  let consecutiveRemoved = 0

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      consecutiveRemoved++
      if (consecutiveRemoved <= 2) cleaned.push("")
      continue
    }

    if (trimmed.length < cfg.minLineLength) {
      consecutiveRemoved++
      continue
    }

    if (cfg.removeNavigation && NAVIGATION_PATTERNS.some(p => p.test(trimmed))) {
      consecutiveRemoved++
      continue
    }

    if (cfg.removeFooter) {
      if (FOOTER_PATTERNS.some(p => p.test(trimmed))) {
        inFooter = true
      }
      if (inFooter) {
        consecutiveRemoved++
        continue
      }
    }

    if (cfg.removeCookie && COOKIE_PATTERNS.some(p => p.test(trimmed))) {
      consecutiveRemoved++
      continue
    }

    if (cfg.removeAds && AD_PATTERNS.some(p => p.test(trimmed))) {
      consecutiveRemoved++
      continue
    }

    if (SHARE_PATTERNS.some(p => p.test(trimmed))) {
      consecutiveRemoved++
      continue
    }

    if (META_PATTERNS.some(p => p.test(trimmed))) {
      consecutiveRemoved++
      continue
    }

    if (cfg.removeSidebar && SIDEBAR_PATTERNS.some(p => p.test(trimmed))) {
      consecutiveRemoved++
      continue
    }

    consecutiveRemoved = 0
    cleaned.push(line)
  }

  let result = cleaned.join("\n")

  for (let i = 0; i < 3; i++) {
    result = result.replace(/\n{3,}/g, "\n\n")
  }

  return result.trim()
}

export class WebScraper {
  private sessionId: string = ""
  private options: ScraperOptions
  private isOpen: boolean = false

  constructor(options: ScraperOptions) {
    this.options = options
  }

  private async exec(args: string[]): Promise<string> {
    const proc = Bun.spawn([XBR_BIN, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = this.options.timeout ?? 30000
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<null>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill()
        reject(new Error(`xbrowser timeout ${timeout}ms`))
      }, timeout)
    })
    const exitCode = await Promise.race([proc.exited, timeoutPromise])
      .finally(() => { if (timeoutId !== undefined) clearTimeout(timeoutId) })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    if (exitCode === null || exitCode !== 0) {
      throw new Error(`xbrowser exit ${exitCode}: ${stderr.slice(0, 200)}`)
    }
    return stdout
  }

  private buildArgs(...extra: string[]): string[] {
    const args: string[] = []
    if (this.options.cdpEndpoint) args.push("--cdp", this.options.cdpEndpoint)
    if (this.options.headless) args.push("--headless")
    args.push(...extra)
    return args
  }

  private sessionArgs(): string[] {
    return ["--session", this.sessionId]
  }

  async open(url: string): Promise<{ title: string; url: string }> {
    if (this.isOpen && this.sessionId) {
      try { await this.close() } catch { /* ignore */ }
    }
    this.sessionId = `ws-${Date.now()}`
    await this.exec([...this.buildArgs(), "open", url, ...this.sessionArgs()])
    this.isOpen = true

    try {
      const titleRaw = await this.eval("document.title")
      const urlRaw = await this.eval("window.location.href")
      return { title: titleRaw.trim(), url: urlRaw.trim() }
    } catch {
      return { title: "", url }
    }
  }

  async getText(cleanConfig?: CleanConfig): Promise<string> {
    try {
      const raw = await this.exec([...this.buildArgs(), "text", ...this.sessionArgs()])
      return cleanContent(raw, cleanConfig)
    } catch {
      return ""
    }
  }

  async getHtml(): Promise<string> {
    try {
      return await this.exec([...this.buildArgs(), "scrape", ...this.sessionArgs(), "--format", "html"])
    } catch {
      return ""
    }
  }

  async nextPage(): Promise<boolean> {
    const js = `(function() {
      var texts = ['\\u4e0b\\u4e00\\u9875', '\\u4e0b\\u9875', 'Next', 'next', '\\u540e\\u9875', '\\u00bb', '\\u203a', '>'];
      var links = Array.from(document.querySelectorAll('a, button'));
      for (var i = 0; i < texts.length; i++) {
        for (var j = 0; j < links.length; j++) {
          if (links[j].textContent.trim() === texts[i]) { links[j].click(); return true; }
        }
      }
      var selectors = ['a[rel="next"]', 'a[aria-label="Next"]', 'a[aria-label="\\u4e0b\\u4e00\\u9875"]', '.next', '.next-page', '.pagination-next', '.pager-next', 'li.next > a', '.page-next', '.page-next a'];
      for (var k = 0; k < selectors.length; k++) {
        try {
          var el = document.querySelector(selectors[k]);
          if (el) { el.click(); return true; }
        } catch(e) {}
      }
      return false;
    })()`
    try {
      const result = await this.eval(js)
      if (result.trim() === "true") {
        await this.exec([...this.buildArgs(), "wait-for-timeout", "2000", ...this.sessionArgs()])
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async getLinks(): Promise<string[]> {
    try {
      const js = `JSON.stringify(Array.from(document.querySelectorAll('a[href]')).map(a => a.href).filter(h => h.startsWith('http')))`
      const raw = await this.eval(js)
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string")
      }
      return []
    } catch {
      return []
    }
  }

  async eval(expression: string): Promise<string> {
    return this.exec([...this.buildArgs(), "eval", expression, ...this.sessionArgs()])
  }

  async scrapePage(url: string, cleanConfig?: CleanConfig): Promise<ScrapedPage> {
    try {
      const info = await this.open(url)
      const rawContent = await this.exec([...this.buildArgs(), "text", ...this.sessionArgs()])
      const content = cleanContent(rawContent, cleanConfig)
      return {
        url: info.url,
        title: info.title,
        content,
        rawContent,
        pageNumber: 1,
      }
    } finally {
      await this.close()
    }
  }

  async scrapePaginated(url: string, cleanConfig?: CleanConfig): Promise<ScrapeResult> {
    const maxPages = this.options.maxPages ?? 5
    const pages: ScrapedPage[] = []
    let title = ""

    try {
      await this.open(url)

      for (let i = 0; i < maxPages; i++) {
        const rawContent = await this.exec([...this.buildArgs(), "text", ...this.sessionArgs()])
        const content = cleanContent(rawContent, cleanConfig)

        let pageTitle = ""
        try { pageTitle = (await this.eval("document.title")).trim() } catch { /* ignore */ }
        if (i === 0) title = pageTitle

        let currentUrl = url
        try { currentUrl = (await this.eval("window.location.href")).trim() } catch { /* ignore */ }

        let links: string[] | undefined
        try { links = await this.getLinks() } catch { /* ignore */ }

        pages.push({
          url: currentUrl,
          title: pageTitle || title,
          content,
          rawContent,
          pageNumber: i + 1,
          links,
        })

        const hasNext = await this.nextPage()
        if (!hasNext) break
      }
    } finally {
      await this.close()
    }

    return {
      pages,
      totalPages: pages.length,
      hasMore: pages.length >= maxPages,
      title,
    }
  }

  async close(): Promise<void> {
    if (!this.isOpen || !this.sessionId) return
    try {
      await this.exec([...this.buildArgs(), "close", ...this.sessionArgs()])
    } catch (e) {
      logger.debug(`close session failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.isOpen = false
      this.sessionId = ""
    }
  }
}
