import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { AsyncLocalStorage } from "node:async_hooks"
import { createLogger } from "./utils/logger.js"


const logger = createLogger("config")

const dirContext = new AsyncLocalStorage<{ dataDir: string; kbDir: string }>()

let _overrideDataDir: string | undefined
let _overrideKbDir: string | undefined

export function getDataDir(): string {
  const ctx = dirContext.getStore()
  if (ctx) return ctx.dataDir
  return _overrideDataDir || process.env.KB_DATA_DIR || join(homedir(), ".kb-chat")
}

export function getKbDir(): string {
  const ctx = dirContext.getStore()
  if (ctx) return ctx.kbDir
  return _overrideKbDir || process.env.KB_DIR || join(homedir(), ".knowledge")
}

export function setOverrideDirs(dataDir?: string, kbDir?: string): void {
  _overrideDataDir = dataDir
  _overrideKbDir = kbDir
}

export function getDirContext(): AsyncLocalStorage<{ dataDir: string; kbDir: string }> {
  return dirContext
}

function getConfigDir(): string { return getDataDir() }
function getConfigPath(): string { return join(getConfigDir(), "config.json") }
const CONFIG_CACHE_TTL = Number(process.env.KB_CONFIG_CACHE_TTL_MS) || 5000

let configCacheMap = new Map<string, { config: AppConfig; time: number }>()

export function clearConfigCache(): void {
  configCacheMap.clear()
}

export interface SearchConfig {
  mode: "combined" | "tfidf" | "semantic"
  minScore: number
  combinedMinScore: number
  weights: { token: number; tfidf: number; semantic: number; fuzzy: number }
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

export function getDefaults(): AppConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG_TEMPLATE))
}

const DEFAULT_CONFIG_TEMPLATE: AppConfig = {
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
    weights: { token: 0.2, tfidf: 0.25, semantic: 0.45, fuzzy: 0.1 },
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

export function loadConfig(forceReload = false): AppConfig {
  const now = Date.now()
  const currentDir = getConfigDir()
  const cached = configCacheMap.get(currentDir)
  if (!forceReload && cached && (now - cached.time) < CONFIG_CACHE_TTL) {
    return JSON.parse(JSON.stringify(cached.config))
  }

  try {
    if (existsSync(getConfigPath())) {
      const raw = removeUndefined(JSON.parse(readFileSync(getConfigPath(), "utf-8")))
      const result: AppConfig = {
        ...getDefaults(),
        ...raw,
        embedding: { ...getDefaults().embedding, ...raw.embedding },
        search: {
          ...getDefaults().search,
          ...raw.search,
          combinedMinScore: raw.search?.combinedMinScore ?? getDefaults().search.combinedMinScore,
          weights: { ...getDefaults().search.weights, ...raw.search?.weights },
        },
        skills: {
          ...getDefaults().skills,
          ...raw.skills,
          paths: (raw.skills?.paths || getDefaults().skills.paths).map(expandPath),
        },
        browser: { ...getDefaults().browser, ...raw.browser, cdpEndpoint: raw.browser?.cdpEndpoint || getDefaults().browser.cdpEndpoint },
        webSearch: { ...getDefaults().webSearch, ...raw.webSearch },
        searchPipeline: {
          ...getDefaults().searchPipeline,
          ...raw.searchPipeline,
          sources: {
            ...getDefaults().searchPipeline.sources,
            ...raw.searchPipeline?.sources,
            webSearchPrime: { ...getDefaults().searchPipeline.sources.webSearchPrime, ...raw.searchPipeline?.sources?.webSearchPrime },
            xbrowser: { ...getDefaults().searchPipeline.sources.xbrowser, ...raw.searchPipeline?.sources?.xbrowser, cdpEndpoint: raw.searchPipeline?.sources?.xbrowser?.cdpEndpoint || getDefaults().searchPipeline.sources.xbrowser.cdpEndpoint },
            llmDirect: { ...getDefaults().searchPipeline.sources.llmDirect, ...raw.searchPipeline?.sources?.llmDirect },
            plugin: { ...getDefaults().searchPipeline.sources.plugin, ...raw.searchPipeline?.sources?.plugin },
            tavily: { ...getDefaults().searchPipeline.sources.tavily, ...raw.searchPipeline?.sources?.tavily },
            serper: { ...getDefaults().searchPipeline.sources.serper, ...raw.searchPipeline?.sources?.serper },
            aiSearch: { ...getDefaults().searchPipeline.sources.aiSearch, ...raw.searchPipeline?.sources?.aiSearch },
          },
        },
        storage: { ...getDefaults().storage, ...raw.storage },
        timeouts: { ...getDefaults().timeouts, ...raw.timeouts },
        askPipeline: { ...getDefaults().askPipeline, ...raw.askPipeline },
      }
      configCacheMap.set(currentDir, { config: result, time: now })
      return result
    }
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
  const fallback = { ...getDefaults(), skills: { ...getDefaults().skills, paths: getDefaults().skills.paths.map(expandPath) }, storage: { ...getDefaults().storage }, timeouts: { ...getDefaults().timeouts }, askPipeline: { ...getDefaults().askPipeline } }
  configCacheMap.set(currentDir, { config: fallback, time: now })
  return fallback
}

export function saveConfig(config: AppConfig): void {
  const dir = getConfigDir()
  configCacheMap.delete(dir)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmpPath = getConfigPath() + ".tmp"
  writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8")
  renameSync(tmpPath, getConfigPath())
}
