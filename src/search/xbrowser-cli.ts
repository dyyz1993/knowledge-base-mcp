export interface XBrowserConfig {
  enabled: boolean
  engine: "google" | "bing" | "baidu"
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
    args.push("--cdp", config.cdpEndpoint)
  }
  if (config.headless) {
    args.push("--headless")
  }
  return args
}

async function runCommand(
  args: string[],
  timeout: number,
): Promise<string> {
  const proc = Bun.spawn(["xbrowser", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await Promise.race([
    proc.exited,
    new Promise<null>((_, reject) =>
      setTimeout(() => {
        proc.kill()
        reject(new Error(`xbrowser timed out after ${timeout}ms`))
      }, timeout),
    ),
  ])

  if (exitCode === null || exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`xbrowser exited with code ${exitCode}: ${stderr}`)
  }

  return new Response(proc.stdout).text()
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

function extractString(val: unknown, field: string): string {
  if (typeof val === "string") return val
  return ""
}

export class XBrowserCLI {
  private config: XBrowserConfig

  constructor(config: XBrowserConfig) {
    this.config = config
  }

  async search(query: string, limit = 5): Promise<SearchResult[]> {
    if (!this.config.enabled) return []

    try {
      const args = [
        "search",
        query,
        "--engine",
        this.config.engine,
        "--limit",
        String(limit),
        "--json",
        ...buildBaseArgs(this.config),
      ]

      const raw = await runCommand(args, this.config.timeout)
      const parsed = parseJsonOutput<unknown>(raw)

      if (!Array.isArray(parsed)) return []

      return parsed
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
    } catch {
      return []
    }
  }

  async scrape(url: string, format: "markdown" | "html" | "text" = "markdown"): Promise<ScrapeResult | null> {
    if (!this.config.enabled) return null

    try {
      const args = [
        "scrape",
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
      return null
    }
  }

  async map(url: string, search?: string): Promise<string[]> {
    if (!this.config.enabled) return []

    try {
      const args = [
        "map",
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
      return []
    }
  }

  async crawl(url: string, limit = 10, maxDepth = 2): Promise<ScrapeResult[]> {
    if (!this.config.enabled) return []

    try {
      const args = [
        "crawl",
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
      return []
    }
  }
}
