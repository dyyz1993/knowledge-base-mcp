import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

const CONFIG_DIR = join(homedir(), ".kb-chat")
const CONFIG_PATH = join(CONFIG_DIR, "config.json")

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
}

export interface AppConfig {
  embedding: EmbeddingConfig
  search: SearchConfig
  skills: SkillConfig
  browser: BrowserConfig
  webSearch: WebSearchConfig
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
  },
}

function expandPath(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p
}

export function loadConfig(): AppConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"))
      return {
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
        browser: { ...DEFAULT_CONFIG.browser, ...raw.browser },
        webSearch: { ...DEFAULT_CONFIG.webSearch, ...raw.webSearch },
      }
    }
  } catch {}
  return { ...DEFAULT_CONFIG, skills: { ...DEFAULT_CONFIG.skills, paths: DEFAULT_CONFIG.skills.paths.map(expandPath) } }
}

export function saveConfig(config: AppConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8")
}
