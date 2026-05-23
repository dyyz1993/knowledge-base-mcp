import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

export interface WebSearchResult {
  title: string
  link: string
  content: string
}

export interface WebReadResult {
  title: string
  content: string
  url: string
}

const SEARCH_ENDPOINT = "https://open.bigmodel.cn/api/mcp/web_search_prime/mcp"
const READER_ENDPOINT = "https://open.bigmodel.cn/api/mcp/web_reader/mcp"

/** Errors that indicate quota/rate limit — cannot recover by retrying. */
const QUOTA_PATTERNS = /429|rate.?limit|quota|exceeded|too many|limit reached/i
/** Errors worth retrying with backoff. */
const RETRY_PATTERNS = /ECONNREFUSED|ETIMEDOUT|ETIMEDOUT|fetch failed|500|502|503|504|network/i

export class McpWebSearch {
  private searchClient: Client | null = null
  private readerClient: Client | null = null
  private apiKey: string
  private _searchDisabled = false   // quota exceeded, stop trying
  private _readerDisabled = false
  private _disabledReason = ""
  private _disabledAt = 0
  private static readonly DISABLED_COOLDOWN_MS = 60_000 // retry after 60s

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /** Whether search is currently available (not quota-exceeded). */
  get searchAvailable(): boolean {
    if (this._searchDisabled && Date.now() - this._disabledAt > McpWebSearch.DISABLED_COOLDOWN_MS) {
      this._searchDisabled = false
      this._disabledReason = ""
      logger.debug("Cooldown expired, re-enabling search")
    }
    return !this._searchDisabled
  }

  /** Whether reader is currently available. */
  get readerAvailable(): boolean {
    return !this._readerDisabled
  }

  /** Human-readable reason if disabled. */
  get disabledReason(): string {
    return this._disabledReason
  }

  private async getSearchClient(): Promise<Client> {
    if (!this.searchClient) {
      this.searchClient = new Client({ name: "kb-mcp-web-search", version: "1.0.0" })
      const transport = new StreamableHTTPClientTransport(new URL(SEARCH_ENDPOINT), {
        requestInit: {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
      })
      await this.searchClient.connect(transport)
    }
    return this.searchClient
  }

  private async getReaderClient(): Promise<Client> {
    if (!this.readerClient) {
      this.readerClient = new Client({ name: "kb-mcp-web-reader", version: "1.0.0" })
      const transport = new StreamableHTTPClientTransport(new URL(READER_ENDPOINT), {
        requestInit: {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        },
      })
      await this.readerClient.connect(transport)
    }
    return this.readerClient
  }

  private classifyError(e: unknown): { message: string; isQuota: boolean; isRetryable: boolean } {
    const message = e instanceof Error ? e.message : String(e)
    return {
      message,
      isQuota: QUOTA_PATTERNS.test(message),
      isRetryable: RETRY_PATTERNS.test(message),
    }
  }

  async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
    if (this._searchDisabled) {
      logger.warn(`Skipped (disabled: ${this._disabledReason})`)
      return []
    }

    const maxRetries = 2
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const client = await this.getSearchClient()
        const result = await client.callTool({
          name: "web_search_prime",
          arguments: {
            search_query: query,
            location: "cn",
            content_size: "medium",
          },
        })

        const content = result.content as Array<{ type: string; text: string }> | undefined
        if (!content?.[0]?.text) return []

        let parsed: unknown = JSON.parse(content[0].text)
        if (typeof parsed === "string") {
          try { parsed = JSON.parse(parsed) } catch { return [] }
        }
        if (!Array.isArray(parsed)) return []

        return parsed.slice(0, maxResults).map((item: Record<string, unknown>) => ({
          title: (item.title as string) || "",
          link: (item.link as string) || (item.url as string) || "",
          content: (item.content as string) || (item.snippet as string) || "",
        }))
      } catch (e: unknown) {
        const { message, isQuota, isRetryable } = this.classifyError(e)

        if (isQuota) {
          this._searchDisabled = true
          this._disabledAt = Date.now()
          this._disabledReason = message.slice(0, 100)
          logger.warn(`Quota/rate limited, disabling search: ${message.slice(0, 80)}`)
          return []
        }

        if (isRetryable && attempt < maxRetries) {
          const backoff = Math.pow(2, attempt) * 1000
          logger.warn(`Retry ${attempt + 1}/${maxRetries} after ${backoff}ms: ${message.slice(0, 60)}`)
          await new Promise(r => setTimeout(r, backoff))
          continue
        }

        logger.error(`Error (attempt ${attempt + 1}): ${message.slice(0, 100)}`)
        return []
      }
    }
    return []
  }

  async readUrl(url: string): Promise<WebReadResult | null> {
    if (this._readerDisabled) {
      logger.warn(`Skipped (disabled: ${this._disabledReason})`)
      return null
    }

    try {
      const client = await this.getReaderClient()
      const result = await client.callTool({
        name: "webReader",
        arguments: {
          url,
          return_format: "markdown",
          retain_images: false,
        },
      })

      const content = result.content as Array<{ type: string; text: string }> | undefined
      if (!content?.[0]?.text) return null

      let parsed: unknown = JSON.parse(content[0].text)
      if (typeof parsed === "string") {
        try { parsed = JSON.parse(parsed) } catch { /* ignore */ }
      }
      const data = parsed as Record<string, unknown>
      return {
        title: (data.title as string) || url,
        content: String(data.content || data.description || "").slice(0, 8000),
        url,
      }
    } catch (e: unknown) {
      const { message, isQuota } = this.classifyError(e)
      if (isQuota) {
        this._readerDisabled = true
        this._disabledReason = message.slice(0, 100)
        logger.warn(`Quota/rate limited, disabling reader: ${message.slice(0, 80)}`)
      } else {
        logger.error(`Error: ${message.slice(0, 100)}`)
      }
      return null
    }
  }

  async close(): Promise<void> {
    const closes: Promise<void>[] = []
    if (this.searchClient) {
      closes.push(this.searchClient.close())
      this.searchClient = null
    }
    if (this.readerClient) {
      closes.push(this.readerClient.close())
      this.readerClient = null
    }
    await Promise.all(closes)
  }
}

import { loadConfig } from "../config"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("search:mcp-web-search")
let _instance: McpWebSearch | null = null

export function getMcpWebSearch(): McpWebSearch | null {
  const config = loadConfig()
  if (!config.webSearch?.apiKey || !config.webSearch.enabled) return null
  if (!_instance) {
    _instance = new McpWebSearch(config.webSearch.apiKey)
  }
  return _instance
}
