export interface DocMeta {
  id: string
  title: string
  tags: string[]
  keywords: string[]
  intent: string
  project_description: string
  source_project: string
  source_worktree: string
  created_at: number
  file_path: string
}

export interface ModelInfo {
  provider: string
  id: string
  name: string
}

export interface SessionInfo {
  id: string
  name: string
  createdAt: number
  messageCount: number
}

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

export interface Message {
  role: "user" | "assistant" | "thinking" | "tool_call" | "tool_result" | "suggestions" | "usage"
  content: string
  timestamp: number
  model?: string
  name?: string
  args?: string
  round?: number
}

export interface Favorite {
  id: string
  sessionId: string
  messageId: string
  content: string
  createdAt: number
}

export interface SessionFavorite {
  sessionId: string
  note?: string
  createdAt: number
}

export interface KBDoc {
  id: string
  title: string
  tags: string[]
  keywords: string[]
  intent: string
  score?: number
  snippet?: string
}

export interface OutlineProject {
  project: string
  name: string
  doc_count: number
  updated_at: number
}

export interface OutlineDoc {
  id: string
  title: string
  tags: string[]
  keywords: string[]
  intent: string
}

export interface Outline {
  project: string
  updated_at: number
  docs: OutlineDoc[]
}

export interface StreamCallbacks {
  onToken: (delta: string, round: number) => void
  onThinking: (delta: string, round: number) => void
  onToolCall: (id: string, name: string, args: string, round: number) => void
  onToolResult: (id: string, name: string, result: string, round: number) => void
  onDone: (messageId: string, round: number) => void
  onError: (error: string) => void
  onSuggestions?: (suggestions: string[]) => void
  onUsage?: (usage: TokenUsage) => void
  onResearchProgress?: (progress: { step: string; status: string; budget?: { usedSteps: number; maxSteps: number }; round: number }) => void
}

export interface EmbeddingConfig {
  provider: "siliconflow" | "local" | "openai" | "custom"
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number
  enabled: boolean
}

export interface SearchConfig {
  mode: "combined" | "tfidf" | "semantic"
  minScore: number
  weights: { token: number; tfidf: number; semantic: number }
}

export interface WebSearchConfig {
  apiKey: string
  enabled: boolean
}

export type XBrowserEngine = "google" | "bing" | "baidu" | "duckduckgo"

export interface SearchPipelineConfig {
  enabled: boolean
  sources: {
    webSearchPrime: { enabled: boolean }
    xbrowser: {
      enabled: boolean
      engine: XBrowserEngine
      engines: XBrowserEngine[]
      cdpEndpoint: string
      headless: boolean
      timeout: number
    }
    llmDirect: {
      enabled: boolean
      baseUrl: string
      apiKey: string
      model: string
    }
    plugin: {
      enabled: boolean
      prompt: string
    }
  }
  maxResults: number
}

export interface AppConfig {
  embedding: EmbeddingConfig
  search: SearchConfig
  webSearch?: WebSearchConfig
  searchPipeline?: SearchPipelineConfig
}

export interface WebSearchItem {
  title: string
  link: string
  content: string
}

export interface AskResult {
  from_kb: boolean
  id?: string
  title?: string
  score?: number
  content?: string
  hint?: string
  miss?: boolean
  query?: string
  error?: string
  web_results?: WebSearchItem[]
  total_misses?: number
  recurring?: boolean
  degraded?: boolean
}

export interface IngestResult {
  saved: boolean
  id: string
  title: string
  miss_resolved: boolean
}

export interface WebReadResult {
  success: boolean
  title: string
  content: string
  url: string
}

export interface PipelineSearchResult {
  title: string
  url: string
  snippet: string
  content?: string
  source: string
  sourceType: string
  qualityScore: number
}

export interface PipelineSearchResponse {
  query: string
  results: PipelineSearchResult[]
  totalSources: number
  durationMs: number
  hint: string
}

export interface DeepReadResult {
  success: boolean
  title: string
  content: string
  url: string
}

export interface SummarizeResult {
  saved: boolean
  id: string
  title: string
}

export interface WorkKeyResult {
  saved: boolean
  id: string
  title: string
  outline: string
  keyPoints: string[]
  sources: Array<{ title: string; url: string; source: string; qualityScore: number }>
  content: string
}

export interface ResearchResult {
  query: string
  searchResults: PipelineSearchResult[]
  evaluatedCount: number
  deepReadCount: number
  summary: string | null
  summaryFallback?: boolean
  sources: Array<{ title: string; url: string }>
  durationMs: number
  phaseLog: string[]
}

export type ResearchMode = "quick" | "standard" | "deep"
export type StepName = "analyze_query" | "search" | "filter_results" | "evaluate" | "deep_read" | "check_sitemap" | "follow_paths" | "evaluate_depth" | "check_github" | "clone_index" | "code_search" | "synthesize"

export interface AgentResearchProgress {
  step: StepName
  status: "pending" | "running" | "done" | "skipped" | "failed"
  budget: { mode: string; usedSteps: number; maxSteps: number; usedCost: number; maxCost: number }
  output?: unknown
  timestamp: number
}

export interface AgentResearchResult {
  query: string
  mode: ResearchMode
  summary: string
  summaryFallback: boolean
  outline: string
  sources: Array<{ title: string; url: string }>
  searchResults: PipelineSearchResult[]
  deepReadResults: Array<{ title: string; url: string; content: string; success: boolean; source: string }>
  progressLog: AgentResearchProgress[]
  phaseLog: string[]
  durationMs: number
  totalSteps: number
  finalQualityScore: number
  finalCoverageScore: number
}
