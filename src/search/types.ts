export type SourceName = "web-search-prime" | "xbrowser" | "xbrowser-bing" | "xbrowser-google" | "xbrowser-baidu" | "xbrowser-duckduckgo" | "llm-direct" | "url-fetch" | "plugin" | "tavily" | "serper" | "ai-search"
export type SourceType = "official" | "documentation" | "platform" | "blog" | "repository" | "llm-knowledge" | "unknown"

export interface SearchResult {
  title: string
  url: string
  snippet: string
  content?: string
  source: SourceName
  sourceType: SourceType
  qualityScore: number
  rawContent?: string
}

export interface SourceTiming {
  name: string
  ms: number
  count: number
  error?: string
}

export interface AggregatedResult {
  query: string
  results: SearchResult[]
  totalSources: number
  durationMs: number
  hint: string
  sourceTimings?: SourceTiming[]
}

export interface SearchSource {
  name: SourceName
  available(): boolean
  search(query: string): Promise<SearchResult[]>
}
