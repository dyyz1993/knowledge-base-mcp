import type { EmbeddingConfig, SearchConfig, SearchPipelineConfig, XBrowserEngine } from "../../services/api"

export const PROVIDERS = [
  { value: "siliconflow", label: "SiliconFlow" },
  { value: "local", label: "Local" },
  { value: "openai", label: "OpenAI" },
  { value: "custom", label: "Custom" },
] as const

export const PRESET_MODELS: Record<string, { value: string; label: string }[]> = {
  siliconflow: [
    { value: "Pro/BAAI/bge-m3", label: "Pro/BAAI/bge-m3" },
    { value: "Qwen/Qwen3-VL-Embedding-8B", label: "Qwen/Qwen3-VL-Embedding-8B" },
    { value: "BAAI/bge-large-zh-v1.5", label: "BAAI/bge-large-zh-v1.5" },
  ],
  openai: [
    { value: "text-embedding-3-small", label: "text-embedding-3-small" },
    { value: "text-embedding-3-large", label: "text-embedding-3-large" },
    { value: "text-embedding-ada-002", label: "text-embedding-ada-002" },
  ],
  local: [],
  custom: [],
}

export const SEARCH_MODES = [
  { value: "combined", label: "Combined (Hybrid)" },
  { value: "tfidf", label: "TF-IDF Only" },
  { value: "semantic", label: "Semantic Only" },
] as const

export const DEFAULT_EMBEDDING: EmbeddingConfig = {
  provider: "siliconflow",
  baseUrl: "https://api.siliconflow.cn/v1",
  apiKey: "",
  model: "Pro/BAAI/bge-m3",
  dimensions: 1024,
  enabled: true,
}

export const DEFAULT_SEARCH: SearchConfig = {
  mode: "combined",
  minScore: 5.0,
  weights: { token: 0.2, tfidf: 0.3, semantic: 0.5 },
}

export interface BrowserConfig {
  cdpEndpoint: string
  browserPath: string
  headless: boolean
  timeout: number
}

export const DEFAULT_BROWSER: BrowserConfig = {
  cdpEndpoint: "",
  browserPath: "",
  headless: true,
  timeout: 15000,
}

export const XBrowserEngineOptions: { value: XBrowserEngine; label: string }[] = [
  { value: "bing", label: "Bing" },
  { value: "google", label: "Google" },
  { value: "baidu", label: "Baidu" },
  { value: "duckduckgo", label: "DuckDuckGo" },
]

export const DEFAULT_SEARCH_PIPELINE: SearchPipelineConfig = {
  enabled: true,
  sources: {
    webSearchPrime: { enabled: true },
    xbrowser: {
      enabled: false,
      engine: "google",
      engines: ["bing"],
      cdpEndpoint: "ws://localhost:9221",
      headless: true,
      timeout: 30000,
    },
    llmDirect: {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      model: "",
    },
    plugin: {
      enabled: false,
      prompt: "",
    },
  },
  maxResults: 10,
}

export type FullConfig = import("../../services/api").AppConfig & {
  browser?: BrowserConfig
  searchPipeline?: SearchPipelineConfig
}
