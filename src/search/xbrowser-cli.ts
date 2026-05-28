
const logger = createLogger("search:xbrowser-cli")
import { createLogger } from "../utils/logger.js"
export type XBrowserEngine = "google" | "bing" | "baidu" | "duckduckgo"
export type XBrowserAIEngine = "deepseek" | "doubao" | "chatgpt" | "claude"

export interface AISearchResultItem {
  title: string
  url: string
  snippet: string
  position: number
  aiSummary?: string
}

export interface AISearchResult {
  query: string
  engine: string
  results: AISearchResultItem[]
  total: number
  aiResponse?: string
}

export interface XBrowserConfig {
  enabled: boolean
  engine: XBrowserEngine
  cdpEndpoint: string
  headless: boolean
  timeout: number
}

export interface ScrapeResult {
  url: string
  title: string
  content: string
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

interface JsonSearchItem {
  title?: string
  url?: string
  link?: string
  snippet?: string
  description?: string
}

interface JsonScrapeItem {
  url?: string
  title?: string
  content?: string
  markdown?: string
}

interface JsonMapResponse {
  urls?: string[]
  links?: string[]
}

function buildBaseArgs(config: XBrowserConfig): string[] {
  const args: string[] = []
  if (config.cdpEndpoint) {
    args.push("--cdp", resolveCdpUrl(config.cdpEndpoint))
  }
  if (config.headless) {
    args.push("--headless")
  }
  return args
}

/** Cache the resolved CDP URL to avoid repeated HTTP calls */
let cachedCdpUrl: string | null = null
let cachedCdpUrlTime = 0
const CDP_URL_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Resolve a CDP base URL (e.g. ws://localhost:9221) to a full browser websocket URL.
 * If the URL already contains "/devtools/browser/", return as-is.
 * Otherwise, fetch /json/version to get the webSocketDebuggerUrl.
 */
function resolveCdpUrl(cdpEndpoint: string): string {
  const normalized = normalizeToIpv4(cdpEndpoint)
  if (normalized.includes("/devtools/browser/")) {
    return normalized
  }

  const now = Date.now()
  if (cachedCdpUrl && now - cachedCdpUrlTime < CDP_URL_TTL) {
    return cachedCdpUrl
  }

  return normalized
}

/**
 * Async version: resolve CDP URL by fetching /json/version.
 * Should be called once at startup or when constructing the CLI.
 */
function normalizeToIpv4(url: string): string {
  return url.replace(/\/\/localhost:/, "//127.0.0.1:")
}

export async function resolveCdpEndpoint(cdpEndpoint: string): Promise<string> {
  if (!cdpEndpoint || cdpEndpoint.includes("/devtools/browser/")) {
    return cdpEndpoint
  }

  const normalized = normalizeToIpv4(cdpEndpoint)

  try {
    const httpUrl = normalized.replace(/^ws/, "http") + "/json/version"
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) })
    const data = await resp.json() as { webSocketDebuggerUrl?: string }
    if (data.webSocketDebuggerUrl) {
      cachedCdpUrl = normalizeToIpv4(data.webSocketDebuggerUrl)
      cachedCdpUrlTime = Date.now()
      logger.debug(`Resolved CDP: ${cdpEndpoint} -> ${cachedCdpUrl}`)
      return cachedCdpUrl
    }
  } catch (e) {
    logger.debug(`Failed to resolve CDP URL from ${cdpEndpoint}: ${e instanceof Error ? e.message : e}`)
  }

  return ensureCdpAvailable(normalized)
}

import { existsSync } from "node:fs"
import { resolve } from "node:path"

const XBR_BIN = resolve(process.cwd(), "node_modules", ".bin", "xbrowser")

let fallbackEndpoint: string | null = null

const CHROMIUM_PATHS = [
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

const FALLBACK_PORT = 9333
const FALLBACK_PROFILE_DIR = "/tmp/kb-chrome-profile"

async function testCdpEndpoint(httpUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(httpUrl, { signal: AbortSignal.timeout(2000) })
    return resp.ok
  } catch {
    return false
  }
}

async function launchFallbackChromium(port = FALLBACK_PORT): Promise<string> {
  const endpoint = `http://127.0.0.1:${port}`
  const versionUrl = `${endpoint}/json/version`

  if (await testCdpEndpoint(versionUrl)) {
    logger.debug(`Fallback Chromium already running on port ${port}, reusing`)
    return endpoint
  }

  const chromiumBin = CHROMIUM_PATHS.find(p => existsSync(p))
  if (!chromiumBin) {
    throw new Error("No Chromium/Chrome binary found for fallback")
  }

  logger.debug(`Launching fallback Chromium on port ${port}: ${chromiumBin}`)

  Bun.spawn([
    chromiumBin,
    `--headless=new`,
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    "--disable-dev-shm-usage",
    `--user-data-dir=${FALLBACK_PROFILE_DIR}`,
  ], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  })

  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await testCdpEndpoint(versionUrl)) {
      logger.debug(`Fallback Chromium ready at ${endpoint}`)
      return endpoint
    }
    await Bun.sleep(250)
  }

  throw new Error(`Fallback Chromium failed to start within 5s on port ${port}`)
}

export async function ensureCdpAvailable(cdpEndpoint: string): Promise<string> {
  if (fallbackEndpoint) return cdpEndpoint

  const httpBase = cdpEndpoint.replace(/^ws/, "http").replace(/\/devtools\/browser\/.*$/, "")
  const versionUrl = `${httpBase}/json/version`

  if (await testCdpEndpoint(versionUrl)) {
    return cdpEndpoint
  }

  logger.debug(`CDP endpoint ${cdpEndpoint} unavailable, launching fallback Chromium`)
  const fb = await launchFallbackChromium()
  fallbackEndpoint = fb
  return `${fb}/devtools/browser/`
}

async function runCommand(
  args: string[],
  timeout: number,
): Promise<string> {
  const proc = Bun.spawn([XBR_BIN, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<null>((_, reject) => {
    timeoutId = setTimeout(() => {
      proc.kill()
      reject(new Error(`xbrowser timed out after ${timeout}ms`))
    }, timeout)
  })

  const exitCode = await Promise.race([proc.exited, timeoutPromise])
    .finally(() => { if (timeoutId !== undefined) clearTimeout(timeoutId) })

  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()

  if (exitCode === null || exitCode !== 0) {
    throw new Error(`xbrowser exited with code ${exitCode}: ${stderr}`)
  }

  if (stderr.trim()) {
    logger.debug(`stderr: ${stderr.trim().substring(0, 200)}`)
  }

  if (!stdout.trim()) {
    throw new Error(`xbrowser returned empty stdout. stderr: ${stderr.substring(0, 200)}`)
  }

  return stdout
}

function parseJsonOutput<T>(raw: string): T {
  const trimmed = raw.trim()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as T
  }
  const jsonStart = trimmed.indexOf("\n{")
  if (jsonStart !== -1) {
    return JSON.parse(trimmed.slice(jsonStart + 1)) as T
  }
  const arrayStart = trimmed.indexOf("\n[")
  if (arrayStart !== -1) {
    return JSON.parse(trimmed.slice(arrayStart + 1)) as T
  }
  throw new Error("No JSON found in xbrowser output")
}

/** Strip ANSI escape codes from string */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[^@-~]*[@-~]/g, "").replace(/\x1b\][^\x07]*\x07/g, "")
}

/** Parse xbrowser YAML-like output into structured data */
function parseYamlOutput(raw: string): SearchResult[] {
  const clean = stripAnsi(raw)
  const lines = clean.split("\n")
  const results: SearchResult[] = []
  let current: Partial<SearchResult> | null = null

  for (const line of lines) {
    const trimmedLine = line.trim()

    // New result item: "1. title: xxx" or just numbered item
    const itemMatch = trimmedLine.match(/^(\d+)\.\s+title:\s*(.+)/)
    if (itemMatch) {
      if (current && current.title && current.url) {
        results.push(current as SearchResult)
      }
      current = { title: itemMatch[2], url: "", snippet: "" }
      continue
    }

    if (!current) {
      // Try "title: xxx" without number prefix
      const titleMatch = trimmedLine.match(/^title:\s*(.+)/)
      if (titleMatch) {
        current = { title: titleMatch[1], url: "", snippet: "" }
      }
      continue
    }

    const urlMatch = trimmedLine.match(/^url:\s*(.+)/)
    if (urlMatch) {
      current.url = urlMatch[1]
      continue
    }

    const snippetMatch = trimmedLine.match(/^snippet:\s*(.+)/)
    if (snippetMatch) {
      current.snippet = snippetMatch[1]
      continue
    }

    // Multi-line snippet continuation
    if (current.snippet && trimmedLine && !trimmedLine.match(/^(query|engine|results|total|timestamp|position):/)) {
      current.snippet += " " + trimmedLine
    }
  }

  if (current && current.title && current.url) {
    results.push(current as SearchResult)
  }

  return results
}

function extractString(val: unknown, field: string): string {
  if (typeof val === "string") return val
  return ""
}

/** Fallback: extract title/url pairs from raw text line by line */
function parseLineBasedFallback(raw: string): SearchResult[] {
  const clean = stripAnsi(raw)
  const urlRegex = /https?:\/\/[^\s)\]>"',]+/g
  const results: SearchResult[] = []
  const lines = clean.split("\n")
  let lastTitle = ""

  for (const line of lines) {
    const urls = line.match(urlRegex)
    if (urls) {
      for (const url of urls) {
        results.push({
          title: lastTitle || url,
          url,
          snippet: "",
        })
      }
      lastTitle = ""
    } else {
      const trimmed = line.trim()
      if (trimmed && !trimmed.match(/^[\s#\-=*]/) && trimmed.length > 3 && trimmed.length < 200) {
        lastTitle = trimmed.replace(/^\d+[\.\)]\s*/, "")
      }
    }
  }

  return results
}

/** Close leftover browser tabs via CDP, keeping only the first tab */
async function cleanupTabs(cdpEndpoint: string): Promise<void> {
  try {
    const httpBase = cdpEndpoint.replace(/^ws/, "http").replace(/\/devtools\/browser\/.*$/, "")
    const listUrl = `${httpBase}/json/list`
    const resp = await fetch(listUrl, { signal: AbortSignal.timeout(3000) })
    const tabs = await resp.json() as Array<{ id: string; url: string; type: string }>
    const closeable = tabs.filter(t => t.type === "page" && t.url && !t.url.startsWith("chrome"))
    if (closeable.length <= 1) return

    for (let i = 1; i < closeable.length; i++) {
      try {
        await fetch(`${httpBase}/json/close/${closeable[i].id}`, { signal: AbortSignal.timeout(2000) })
      } catch {
        /* 忽略: 关闭单个 tab 失败不影响主流程 */
      }
    }
    logger.debug(`cleanupTabs: closed ${closeable.length - 1}/${tabs.length} tabs`)
  } catch {
    /* 忽略: Tab 清理是 best-effort 操作 */
  }
}

export class XBrowserCLI {
  private config: XBrowserConfig
  private cdpResolved = false

  constructor(config: XBrowserConfig) {
    this.config = config
  }

  /** Ensure CDP endpoint is resolved to full browser URL */
  private async ensureCdpResolved(): Promise<void> {
    if (this.cdpResolved) return
    if (this.config.cdpEndpoint && !this.config.cdpEndpoint.includes("/devtools/browser/")) {
      this.config.cdpEndpoint = await resolveCdpEndpoint(this.config.cdpEndpoint)
    }
    this.cdpResolved = true
  }

  async search(query: string, limit = 10): Promise<SearchResult[]> {
    if (!this.config.enabled) return []

    try {
      await this.ensureCdpResolved()

      const args = [
        "search",
        query,
        "--engine",
        this.config.engine,
        "--limit",
        String(limit),
        ...buildBaseArgs(this.config),
      ]

      const raw = await runCommand(args, this.config.timeout)
      logger.debug(`raw output for engine=${this.config.engine}: length=${raw.length}, preview=${raw.substring(0, 200)}`)

      // Priority: YAML parse > JSON parse > line-based fallback
      const yamlResults = parseYamlOutput(raw)
      if (yamlResults.length > 0) {
        logger.debug(`search("${query}") engine=${this.config.engine}: parsed ${yamlResults.length} results from YAML`)
        return yamlResults
      }

      let items: unknown[]
      try {
        const parsed = parseJsonOutput<unknown>(raw)

        if (Array.isArray(parsed)) {
          items = parsed
        } else if (typeof parsed === "object" && parsed !== null) {
          const obj = parsed as Record<string, unknown>
          if (Array.isArray(obj.results)) {
            items = obj.results
          } else if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
            const inner = obj.data as Record<string, unknown>
            items = Array.isArray(inner.results) ? inner.results : []
          } else if (Array.isArray(obj.data)) {
            items = obj.data
          } else {
            logger.debug(`Object response has no results/data keys: ${JSON.stringify(Object.keys(obj))}`)
            return []
          }
        } else {
          logger.debug(`Unexpected parsed type: ${typeof parsed}`)
          return []
        }
      } catch {
        /* 忽略: JSON/YAML 解析失败，回退到行级解析 */
        const fallbackResults = parseLineBasedFallback(raw)
        if (fallbackResults.length > 0) {
          logger.debug(`search("${query}") engine=${this.config.engine}: parsed ${fallbackResults.length} results from line-based fallback`)
          return fallbackResults
        }
        logger.debug(`parseYaml, parseJson, and line-based all failed for engine=${this.config.engine} query="${query}"`)
        return []
      }

      const mapped = items
        .map((item: unknown): SearchResult | null => {
          if (typeof item !== "object" || item === null) return null
          const obj = item as Record<string, unknown>
          return {
            title: extractString(obj.title, "title") || extractString(obj.name, "name"),
            url: extractString(obj.url, "url") || extractString(obj.link, "link"),
            snippet: extractString(obj.snippet, "snippet") || extractString(obj.description, "description"),
          }
        })
        .filter((r): r is SearchResult => r !== null && r.url !== "")

      logger.debug(`search("${query}") engine=${this.config.engine}: items=${items.length} mapped=${mapped.length}`)
      return mapped
    } catch (e) {
      logger.debug(`search FAILED engine=${this.config.engine} query="${query}": ${e instanceof Error ? e.message : String(e)}`)
      return []
    } finally {
      cleanupTabs(this.config.cdpEndpoint).catch((e) => { logger.debug("cleanupTabs in finally failed", e instanceof Error ? e.message : String(e)) })
    }
  }

  async scrape(url: string, format: "markdown" | "html" | "text" = "markdown"): Promise<ScrapeResult | null> {
    if (!this.config.enabled) return null

    try {
      await this.ensureCdpResolved()

      const args = [
        url,
        "--format",
        format,
        ...buildBaseArgs(this.config),
      ]

      const raw = await runCommand(args, this.config.timeout)

      try {
        const parsed = parseJsonOutput<JsonScrapeItem>(raw)
        return {
          url: parsed.url || url,
          title: parsed.title || "",
          content: parsed.content || parsed.markdown || "",
        }
      } catch {
        /* 忽略: JSON 解析失败，回退到纯文本解析 */
        const lines = raw.split("\n")
        const titleLine = lines[0] || ""
        const title = titleLine.startsWith("# ")
          ? titleLine.slice(2).trim()
          : ""
        return {
          url,
          title,
          content: raw,
        }
      }
    } catch {
      /* 忽略: scrape 整体失败返回 null */
      return null
    }
  }

  async getText(url: string): Promise<string | null> {
    if (!this.config.enabled) return null

    try {
      await this.ensureCdpResolved()

      const sessionId = `kb-disc-${Date.now()}`
      const baseArgs = buildBaseArgs(this.config)

      await runCommand(["open", url, "--session", sessionId, ...baseArgs], this.config.timeout)

      const textArgs = ["text", "--session", sessionId, ...baseArgs]
      const raw = await runCommand(textArgs, this.config.timeout)

      try {
        await runCommand(["close", "--session", sessionId, ...baseArgs], 5000)
      } catch { /* ignore */ }

      return raw.trim() || null
    } catch {
      return null
    }
  }

  async map(url: string, search?: string): Promise<string[]> {
    if (!this.config.enabled) return []

    try {
      await this.ensureCdpResolved()

      const args = [
        url,
        "--json",
        ...buildBaseArgs(this.config),
      ]

      if (search) {
        args.push("--search", search)
      }

      const raw = await runCommand(args, this.config.timeout)
      const parsed = parseJsonOutput<unknown>(raw)

      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === "string")
      }

      if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>
        const urls = obj.urls || obj.links
        if (Array.isArray(urls)) {
          return urls.filter((v): v is string => typeof v === "string")
        }
      }

      return []
    } catch {
      /* 忽略: map URL 发现失败返回空数组 */
      return []
    }
  }

  async aiSearch(
    query: string,
    engine: XBrowserAIEngine = "deepseek",
    options?: { limit?: number; timeout?: number },
  ): Promise<AISearchResult | null> {
    if (!this.config.enabled) return null

    const timeout = options?.timeout ?? 60000
    try {
      await this.ensureCdpResolved()

      const args = [
        "ai-search",
        query,
        "--engine",
        engine,
        "--limit",
        String(options?.limit ?? 10),
        "--format",
        "json",
        ...buildBaseArgs(this.config),
        "--timeout",
        String(timeout),
      ]

      const raw = await runCommand(args, timeout + 5000)
      const parsed = parseJsonOutput<unknown>(raw)

      if (typeof parsed === "object" && parsed !== null) {
        const obj = parsed as Record<string, unknown>
        if (obj.content && typeof obj.content === "object") {
          return (obj.content as Record<string, unknown>) as unknown as AISearchResult
        }
        return parsed as unknown as AISearchResult
      }

      return null
    } catch (e) {
      logger.debug(`aiSearch FAILED engine=${engine} query="${query}": ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  }

  async crawl(url: string, limit = 10, maxDepth = 2): Promise<ScrapeResult[]> {
    if (!this.config.enabled) return []

    try {
      await this.ensureCdpResolved()

      const args = [
        url,
        "--limit",
        String(limit),
        "--max-depth",
        String(maxDepth),
        "--json",
        ...buildBaseArgs(this.config),
      ]

      const raw = await runCommand(args, this.config.timeout)
      const parsed = parseJsonOutput<unknown>(raw)

      if (!Array.isArray(parsed)) return []

      return parsed
        .map((item: unknown): ScrapeResult | null => {
          if (typeof item !== "object" || item === null) return null
          const obj = item as Record<string, unknown>
          return {
            url: extractString(obj.url, "url"),
            title: extractString(obj.title, "title"),
            content: extractString(obj.content, "content") || extractString(obj.markdown, "markdown"),
          }
        })
        .filter((r): r is ScrapeResult => r !== null && r.url !== "")
    } catch {
      /* 忽略: crawl 失败返回空数组 */
      return []
    }
  }
}
