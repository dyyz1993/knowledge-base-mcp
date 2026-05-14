const BASE = ""

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
}

export async function fetchDocs(): Promise<DocMeta[]> {
  const res = await fetch(`${BASE}/api/docs`)
  return res.json()
}

export async function fetchDoc(id: string): Promise<{ meta: DocMeta; content: string; truncated: boolean } | null> {
  const res = await fetch(`${BASE}/api/docs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  })
  return res.json()
}

export async function searchDocs(query: string, keywords?: string[], tags?: string[], limit = 20) {
  const res = await fetch(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, keywords, tags, limit }),
  })
  return res.json()
}

export async function streamChat(params: {
  message: string
  sessionId: string
  model?: { provider: string; id: string }
} & StreamCallbacks): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: params.message,
      sessionId: params.sessionId,
      model: params.model,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    params.onError(text || `HTTP ${res.status}`)
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith("data: ") && currentEvent) {
        const raw = line.slice(6)
        let data: Record<string, unknown>
        try { data = JSON.parse(raw) } catch { continue }
        const round = typeof data.round === "number" ? data.round : 0
        switch (currentEvent) {
          case "token": params.onToken(String(data.delta || ""), round); break
          case "thinking": params.onThinking(String(data.delta || ""), round); break
          case "tool_call": params.onToolCall(String(data.id || ""), String(data.name || ""), String(data.args || ""), round); break
          case "tool_call_delta": break
          case "tool_result": params.onToolResult(String(data.id || ""), String(data.name || ""), String(data.content || data.result || ""), round); break
          case "done": {
            if (data.usage) {
              params.onUsage?.(data.usage as TokenUsage)
            }
            params.onDone(String(data.messageId || ""), round)
            break
          }
          case "suggestions":
            if (params.onSuggestions) {
              try { params.onSuggestions(JSON.parse(String(data.suggestions || data.data || "[]"))) } catch { /* ignore */ }
            }
            break
          case "error": params.onError(String(data.error || "Unknown error")); break
        }
        currentEvent = ""
      }
    }
  }
}

export async function getModels(): Promise<{ models: ModelInfo[]; current: { provider: string; id: string } | null }> {
  const res = await fetch(`${BASE}/api/models`)
  return res.json()
}

export async function setModel(sessionId: string, provider: string, id: string) {
  const res = await fetch(`${BASE}/api/models`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, provider, id }),
  })
  return res.json()
}

export async function listSessions(): Promise<SessionInfo[]> {
  const res = await fetch(`${BASE}/api/sessions`)
  return res.json()
}

export async function createSession(): Promise<{ id: string; name: string }> {
  const res = await fetch(`${BASE}/api/sessions`, { method: "POST" })
  return res.json()
}

export async function renameSession(id: string, name: string) {
  await fetch(`${BASE}/api/sessions/${id}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

export async function deleteSession(id: string) {
  await fetch(`${BASE}/api/sessions/${id}`, { method: "DELETE" })
}

export async function getSessionMessages(id: string): Promise<Message[]> {
  const res = await fetch(`${BASE}/api/sessions/${id}/messages`)
  return res.json()
}

export async function listFavorites(): Promise<Favorite[]> {
  const res = await fetch(`${BASE}/api/favorites`)
  return res.json()
}

export async function addFavorite(sessionId: string, messageId: string, content: string): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messageId, content }),
  })
  return res.json()
}

export async function deleteFavorite(id: string) {
  await fetch(`${BASE}/api/favorites/${id}`, { method: "DELETE" })
}

export async function searchKB(query: string, limit = 10): Promise<KBDoc[]> {
  const res = await fetch(`${BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  })
  const data = await res.json()
  return data.documents || data
}

export async function writeKB(params: {
  title: string
  content: string
  tags: string[]
  keywords: string[]
  intent?: string
}): Promise<{ id: string; title: string; filePath: string }> {
  const res = await fetch(`${BASE}/api/docs/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  return res.json()
}

export async function fetchOutlines(): Promise<OutlineProject[]> {
  const res = await fetch(`${BASE}/api/outlines`)
  return res.json()
}

export async function fetchOutline(project: string): Promise<Outline | null> {
  const res = await fetch(`${BASE}/api/outline?project=${encodeURIComponent(project)}`)
  return res.json()
}

export async function readDoc(id: string): Promise<{ meta: DocMeta; content: string; truncated: boolean } | null> {
  const res = await fetch(`${BASE}/api/doc/${encodeURIComponent(id)}`)
  return res.json()
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

export interface SearchPipelineConfig {
  enabled: boolean
  sources: {
    webSearchPrime: { enabled: boolean }
    xbrowser: {
      enabled: boolean
      engine: "google" | "bing" | "baidu"
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

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch(`${BASE}/api/config`)
  return res.json()
}

export async function updateConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  const res = await fetch(`${BASE}/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  })
  return res.json()
}

export async function reindexEmbeddings(): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${BASE}/api/embedding/reindex`, { method: "POST" })
  return res.json()
}

export async function listSessionFavorites(): Promise<SessionFavorite[]> {
  const res = await fetch(`${BASE}/api/session-favorites`)
  if (!res.ok) return []
  return res.json()
}

export async function addSessionFavorite(sessionId: string, note?: string): Promise<void> {
  await fetch(`${BASE}/api/session-favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, note }),
  })
}

export async function removeSessionFavorite(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/session-favorites/${sessionId}`, { method: "DELETE" })
}

export function buildShareUrl(sessionId: string): string {
  const loc = window.location
  return `${loc.protocol}//${loc.hostname}:${loc.port}/api/share/${sessionId}`
}

export async function scanSkills(): Promise<{ total: number; imported: number; skipped: number; errors: string[] }> {
  const res = await fetch(`${BASE}/api/skills/scan`, { method: "POST" })
  return res.json()
}

export async function getSkillPaths(): Promise<{ paths: string[] }> {
  const res = await fetch(`${BASE}/api/skills/paths`)
  return res.json()
}

export async function updateSkillPaths(paths: string[]): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/api/skills/paths`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  })
  return res.json()
}

export async function getDocKeywords(): Promise<{ keywords: string[]; count: number }> {
  const res = await fetch(`${BASE}/api/docs/keywords`)
  return res.json()
}

export async function detectBrowser(): Promise<{ path: string | null }> {
  const res = await fetch(`${BASE}/api/browser/detect`)
  return res.json()
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
  web_results?: WebSearchItem[]
  total_misses?: number
  recurring?: boolean
}

export interface IngestResult {
  saved: boolean
  id: string
  title: string
  miss_resolved: boolean
}

export async function smartAsk(query: string): Promise<AskResult> {
  const res = await fetch(`${BASE}/api/kb-ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })
  return res.json()
}

export async function ingestWebContent(params: {
  url: string
  title: string
  content: string
  tags?: string[]
  keywords?: string[]
}): Promise<IngestResult> {
  const res = await fetch(`${BASE}/api/kb-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  return res.json()
}

export interface WebReadResult {
  success: boolean
  title: string
  content: string
  url: string
}

export async function webRead(url: string): Promise<WebReadResult> {
  const res = await fetch(`${BASE}/api/web-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  return res.json()
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

export async function askSearch(query: string): Promise<PipelineSearchResponse> {
  const res = await fetch(`${BASE}/api/ask-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })
  return res.json()
}

export async function askDeepRead(url: string): Promise<DeepReadResult> {
  const res = await fetch(`${BASE}/api/ask-deep-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  return res.json()
}

export async function askSummarize(params: {
  query: string
  title: string
  content: string
  url?: string
  tags?: string[]
  keywords?: string[]
}): Promise<SummarizeResult> {
  const res = await fetch(`${BASE}/api/ask-summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  return res.json()
}
