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

export class McpWebSearch {
  private searchClient: Client | null = null
  private readerClient: Client | null = null
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
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

  async search(query: string, maxResults = 5): Promise<WebSearchResult[]> {
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
      console.error("MCP web search error:", e instanceof Error ? e.message : e)
      return []
    }
  }

  async readUrl(url: string): Promise<WebReadResult | null> {
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
      console.error("MCP web reader error:", e instanceof Error ? e.message : e)
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

let _instance: McpWebSearch | null = null

export function getMcpWebSearch(): McpWebSearch | null {
  const config = loadConfig()
  if (!config.webSearch?.apiKey || !config.webSearch.enabled) return null
  if (!_instance) {
    _instance = new McpWebSearch(config.webSearch.apiKey)
  }
  return _instance
}
