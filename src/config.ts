import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { createLogger } from "./utils/logger.js"


const logger = createLogger("config")

export function getDataDir(): string {
  return process.env.KB_DATA_DIR || join(homedir(), ".kb-chat")
}

export function getKbDir(): string {
  return process.env.KB_DIR || join(homedir(), ".knowledge")
}

function getConfigDir(): string { return getDataDir() }
function getConfigPath(): string { return join(getConfigDir(), "config.json") }
const CONFIG_CACHE_TTL = Number(process.env.KB_CONFIG_CACHE_TTL_MS) || 5000

let configCache: AppConfig | null = null
let configCacheTime = 0

export interface EmbeddingConfig {
  provider: "siliconflow" | "local" | "openai" | "custom"
  baseUrl: string
  apiKey: string
  model: string
  dimensions: number
  enabled: boolean
  autoDownload: boolean
}

export interface SearchConfig {
  mode: "combined" | "tfidf" | "semantic"
  minScore: number
  combinedMinScore: number
  weights: { token: number; tfidf: number; semantic: number }
}

export interface SkillConfig {
  paths: string[]
  autoScan: boolean
}

export interface BrowserConfig {
  cdpEndpoint: string
  executablePath: string
  headless: boolean
  defaultTimeout: number
}

export interface WebSearchConfig {
  apiKey: string
  enabled: boolean
  tavilyApiKey: string
  serperApiKey: string
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
    tavily: { enabled: boolean }
    serper: { enabled: boolean }
    aiSearch: {
      enabled: boolean
      engines: string[]
      timeout: number
    }
  }
  maxResults: number
}

export interface StorageConfig {
  cacheTtlMs: number
}

export interface TimeoutsConfig {
  webReadMs: number
  deepReadMs: number
}

export interface AskPipelineConfig {
  maxLoops: number
  highScoreThreshold: number
  lowScoreThreshold: number
}

export interface AppConfig {
  embedding: EmbeddingConfig
  search: SearchConfig
  skills: SkillConfig
  browser: BrowserConfig
  webSearch: WebSearchConfig
  searchPipeline: SearchPipelineConfig
  storage: StorageConfig
  timeouts: TimeoutsConfig
  askPipeline: AskPipelineConfig
}

const DEFAULT_SKILL_PATHS = [
  "~/.agents/skills",
  "~/.claude/skills",
  "~/.config/opencode/skills",
]

const DEFAULT_CONFIG: AppConfig = {
  embedding: {
    provider: "siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiKey: "",
    model: "Pro/BAAI/bge-m3",
    dimensions: 1024,
    enabled: false,
    autoDownload: true,
  },
  search: {
    mode: "combined",
    minScore: 5.0,
    combinedMinScore: 0.05,
    weights: { token: 0.2, tfidf: 0.3, semantic: 0.5 },
  },
  skills: {
    paths: DEFAULT_SKILL_PATHS,
    autoScan: false,
  },
  browser: {
    cdpEndpoint: "",
    executablePath: "",
    headless: true,
    defaultTimeout: 15000,
  },
  webSearch: {
    apiKey: "",
    enabled: true,
    tavilyApiKey: "",
    serperApiKey: "",
  },
  searchPipeline: {
    enabled: true,
    sources: {
      webSearchPrime: { enabled: true },
      xbrowser: {
        enabled: false,
        engine: "google",
        engines: ["google"] as XBrowserEngine[],
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
      tavily: { enabled: true },
      serper: { enabled: true },
      aiSearch: {
        enabled: true,
        engines: ["deepseek", "doubao"],
        timeout: 60000,
      },
    },
    maxResults: 10,
  },
  storage: {
    cacheTtlMs: 5000,
  },
  timeouts: {
    webReadMs: 15000,
    deepReadMs: 10000,
  },
  askPipeline: {
    maxLoops: 2,
    highScoreThreshold: 45,
    lowScoreThreshold: 20,
  },
}

function expandPath(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p
}

function removeUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        result[key] = removeUndefined(value as Record<string, unknown>)
      } else {
        result[key] = value
      }
    }
  }
  return result as T
}

export function clearConfigCache(): void {
  configCache = null
  configCacheTime = 0
}

export function loadConfig(forceReload = false): AppConfig {
  const now = Date.now()
  if (!forceReload && configCache && (now - configCacheTime) < CONFIG_CACHE_TTL) {
    return configCache
  }

  try {
    if (existsSync(getConfigPath())) {
      const raw = removeUndefined(JSON.parse(readFileSync(getConfigPath(), "utf-8")))
      const result: AppConfig = {
        ...DEFAULT_CONFIG,
        ...raw,
        embedding: { ...DEFAULT_CONFIG.embedding, ...raw.embedding },
        search: {
          ...DEFAULT_CONFIG.search,
          ...raw.search,
          combinedMinScore: raw.search?.combinedMinScore ?? DEFAULT_CONFIG.search.combinedMinScore,
          weights: { ...DEFAULT_CONFIG.search.weights, ...raw.search?.weights },
        },
        skills: {
          ...DEFAULT_CONFIG.skills,
          ...raw.skills,
          paths: (raw.skills?.paths || DEFAULT_CONFIG.skills.paths).map(expandPath),
        },
        browser: { ...DEFAULT_CONFIG.browser, ...raw.browser, cdpEndpoint: raw.browser?.cdpEndpoint || DEFAULT_CONFIG.browser.cdpEndpoint },
        webSearch: { ...DEFAULT_CONFIG.webSearch, ...raw.webSearch },
        searchPipeline: {
          ...DEFAULT_CONFIG.searchPipeline,
          ...raw.searchPipeline,
          sources: {
            ...DEFAULT_CONFIG.searchPipeline.sources,
            ...raw.searchPipeline?.sources,
            webSearchPrime: { ...DEFAULT_CONFIG.searchPipeline.sources.webSearchPrime, ...raw.searchPipeline?.sources?.webSearchPrime },
            xbrowser: { ...DEFAULT_CONFIG.searchPipeline.sources.xbrowser, ...raw.searchPipeline?.sources?.xbrowser, cdpEndpoint: raw.searchPipeline?.sources?.xbrowser?.cdpEndpoint || DEFAULT_CONFIG.searchPipeline.sources.xbrowser.cdpEndpoint },
            llmDirect: { ...DEFAULT_CONFIG.searchPipeline.sources.llmDirect, ...raw.searchPipeline?.sources?.llmDirect },
            plugin: { ...DEFAULT_CONFIG.searchPipeline.sources.plugin, ...raw.searchPipeline?.sources?.plugin },
            tavily: { ...DEFAULT_CONFIG.searchPipeline.sources.tavily, ...raw.searchPipeline?.sources?.tavily },
            serper: { ...DEFAULT_CONFIG.searchPipeline.sources.serper, ...raw.searchPipeline?.sources?.serper },
            aiSearch: { ...DEFAULT_CONFIG.searchPipeline.sources.aiSearch, ...raw.searchPipeline?.sources?.aiSearch },
          },
        },
        storage: { ...DEFAULT_CONFIG.storage, ...raw.storage },
        timeouts: { ...DEFAULT_CONFIG.timeouts, ...raw.timeouts },
        askPipeline: { ...DEFAULT_CONFIG.askPipeline, ...raw.askPipeline },
      }
      configCache = result
      configCacheTime = now
      return result
    }
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
  const fallback = { ...DEFAULT_CONFIG, skills: { ...DEFAULT_CONFIG.skills, paths: DEFAULT_CONFIG.skills.paths.map(expandPath) }, storage: { ...DEFAULT_CONFIG.storage }, timeouts: { ...DEFAULT_CONFIG.timeouts }, askPipeline: { ...DEFAULT_CONFIG.askPipeline } }
  configCache = fallback
  configCacheTime = now
  return fallback
}

export function saveConfig(config: AppConfig): void {
  configCache = null
  if (!existsSync(getConfigDir())) mkdirSync(getConfigDir(), { recursive: true })
  const tmpPath = getConfigPath() + ".tmp"
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8")
  renameSync(tmpPath, getConfigPath())
}
