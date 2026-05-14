export type SourceName = "web-search-prime" | "xbrowser" | "llm-direct" | "url-fetch" | "plugin"
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

export interface AggregatedResult {
  query: string
  results: SearchResult[]
  totalSources: number
  durationMs: number
  hint: string
}

export interface SearchSource {
  name: SourceName
  available(): boolean
  search(query: string): Promise<SearchResult[]>
}
