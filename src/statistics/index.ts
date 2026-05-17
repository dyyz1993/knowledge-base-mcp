import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const STATS_DIR = `${process.env.HOME}/.kb-chat/stats`
const SEARCH_STATS_PATH = `${STATS_DIR}/search.json`
const LLM_STATS_PATH = `${STATS_DIR}/llm.json`
const EMBEDDING_STATS_PATH = `${STATS_DIR}/embedding.json`
const MCP_STATS_PATH = `${STATS_DIR}/mcp.json`

function ensureStatsDir() {
  if (!existsSync(STATS_DIR)) {
    mkdirSync(STATS_DIR, { recursive: true })
   }
}

interface SearchSourceCall {
  name: string
  count: number
  totalTime: number
  avgTime: number
  lastCalledAt: number
  errors: number
}

interface SearchStats {
  sources: Record<string, SearchSourceCall>
  totalQueries: number
  totalResults: number
  updatedAt: number
}

interface LLMCall {
  model: string
  count: number
  totalTokens: number
  totalCost: number
  totalTime: number
  avgTime: number
  lastCalledAt: number
}

interface LLMStats {
  models: Record<string, LLMCall>
  updatedAt: number
}

interface EmbeddingStats {
  count: number
  totalTokens: number
  totalTime: number
  avgTime: number
  lastCalledAt: number
  updatedAt: number
}

interface MCPToolCall {
  name: string
  args?: Record<string, unknown>
  count: number
  totalTime: number
  avgTime: number
  lastCalledAt: number
  errors: number
}

interface MCPStats {
  tools: Record<string, MCPToolCall>
  updatedAt: number
}

export class SearchStatistics {
  private stats: SearchStats = {
    sources: {},
    totalQueries: 0,
    totalResults: 0,
    updatedAt: Date.now(),
  }

  constructor() {
    ensureStatsDir()
    this.load()
  }

  private load() {
    if (existsSync(SEARCH_STATS_PATH)) {
      try {
        this.stats = JSON.parse(readFileSync(SEARCH_STATS_PATH, "utf-8"))
      } catch {
      }
    }
  }

  private save() {
    this.stats.updatedAt = Date.now()
    writeFileSync(SEARCH_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  recordSourceCall(name: string, count: number, timeMs: number, error = false) {
    const key = name
    if (!this.stats.sources[key]) {
      this.stats.sources[key] = {
        name,
        count: 0,
        totalTime: 0,
        avgTime: 0,
        lastCalledAt: 0,
        errors: 0,
        totalResults: 0,
      }
    }

    const source = this.stats.sources[key]
    source.count++
    source.totalTime += timeMs
    source.avgTime = source.totalTime / source.count
    source.lastCalledAt = Date.now()
    if (error) source.errors++
    source.totalResults = (source.totalResults || 0) + count

    this.stats.totalResults += count

    console.log(`[stats] Search source: ${name} | call #${source.count} | ${count} results | ${timeMs}ms | avg: ${source.avgTime.toFixed(1)}ms`)

    this.save()
  }

  recordQuery() {
    this.stats.totalQueries++
    this.save()
  }

  getStats(): SearchStats {
    return { ...this.stats }
  }

  getSourceStats(name: string): SearchSourceCall | undefined {
    return this.stats.sources[name]
  }

  reset() {
    this.stats = {
      sources: {},
      totalQueries: 0,
      totalResults: 0,
      updatedAt: Date.now(),
    }
    this.save()
  }
}

export class LLMStatistics {
  private stats: LLMStats = {
    models: {},
    updatedAt: Date.now(),
  }

  constructor() {
    ensureStatsDir()
    this.load()
  }

  private load() {
    if (existsSync(LLM_STATS_PATH)) {
      try {
        this.stats = JSON.parse(readFileSync(LLM_STATS_PATH, "utf-8"))
      } catch {
      }
    }
  }

  private save() {
    this.stats.updatedAt = Date.now()
    writeFileSync(LLM_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  recordCall(model: string, tokens: number, timeMs: number, cost: number = 0) {
    const key = model
    if (!this.stats.models[key]) {
      this.stats.models[key] = {
        model,
        count: 0,
        totalTokens: 0,
        totalCost: 0,
        totalTime: 0,
        avgTime: 0,
        lastCalledAt: 0,
      }
    }

    const modelStats = this.stats.models[key]
    modelStats.count++
    modelStats.totalTokens += tokens
    modelStats.totalCost += cost
    modelStats.totalTime += timeMs
    modelStats.avgTime = modelStats.totalTime / modelStats.count
    modelStats.lastCalledAt = Date.now()

    console.log(`[stats] LLM: ${model} | call #${modelStats.count} | ${tokens} tokens | ${timeMs}ms | cost: $${cost.toFixed(4)}`)

    this.save()
  }

  getStats(): LLMStats {
    return { ...this.stats }
  }

  reset() {
    this.stats = {
      models: {},
      updatedAt: Date.now(),
    }
    this.save()
  }
}

export class EmbeddingStatistics {
  private stats: EmbeddingStats = {
    count: 0,
    totalTokens: 0,
    totalTime: 0,
    avgTime: 0,
    lastCalledAt: 0,
    updatedAt: Date.now(),
  }

  constructor() {
    ensureStatsDir()
    this.load()
  }

  private load() {
    if (existsSync(EMBEDDING_STATS_PATH)) {
      try {
        this.stats = JSON.parse(readFileSync(EMBEDDING_STATS_PATH, "utf-8"))
      } catch {
      }
    }
  }

  private save() {
    this.stats.updatedAt = Date.now()
    writeFileSync(EMBEDDING_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  recordCall(tokens: number, timeMs: number) {
    this.stats.count++
    this.stats.totalTokens += tokens
    this.stats.totalTime += timeMs
    this.stats.avgTime = this.stats.totalTime / this.stats.count
    this.stats.lastCalledAt = Date.now()

    console.log(`[stats] Embedding: call #${this.stats.count} | ${tokens} tokens | ${timeMs}ms`)

    this.save()
  }

  getStats(): EmbeddingStats {
    return { ...this.stats }
  }

  reset() {
    this.stats = {
      count: 0,
      totalTokens: 0,
      totalTime: 0,
      avgTime: 0,
      lastCalledAt: 0,
      updatedAt: Date.now(),
    }
    this.save()
  }
}

export class MCPStatistics {
  private stats: MCPStats = {
    tools: {},
    updatedAt: Date.now(),
  }

  constructor() {
    ensureStatsDir()
    this.load()
  }

  private load() {
    if (existsSync(MCP_STATS_PATH)) {
      try {
        this.stats = JSON.parse(readFileSync(MCP_STATS_PATH, "utf-8"))
      } catch {
      }
    }
  }

  private save() {
    this.stats.updatedAt = Date.now()
    writeFileSync(MCP_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  recordToolCall(name: string, args: Record<string, unknown> = {}, timeMs: number, error = false) {
    const key = name
    if (!this.stats.tools[key]) {
      this.stats.tools[key] = {
        name,
        args: {},
        count: 0,
        totalTime: 0,
        avgTime: 0,
        lastCalledAt: 0,
        errors: 0,
      }
    }

    const tool = this.stats.tools[key]
    if (Object.keys(args).length > 0) tool.args = args
    tool.count++
    tool.totalTime += timeMs
    tool.avgTime = tool.totalTime / tool.count
    tool.lastCalledAt = Date.now()
    if (error) tool.errors++

    console.log(`[stats] MCP tool: ${name} | call #${tool.count} | ${timeMs}ms | avg: ${tool.avgTime.toFixed(1)}ms`)

    this.save()
  }

  getStats(): MCPStats {
    return { ...this.stats }
  }

  getToolStats(name: string): MCPToolCall | undefined {
    return this.stats.tools[name]
  }

  reset() {
    this.stats = {
      tools: {},
      updatedAt: Date.now(),
    }
    this.save()
  }
}

export function ensureStatsDir() {
  const { mkdirSync } = require("node:fs")
  if (!existsSync(STATS_DIR)) {
    mkdirSync(STATS_DIR, { recursive: true })
  }
}

// Global singletons - initialized once per process
if (!globalThis.__kb_searchStats__) {
  ensureStatsDir()
  globalThis.__kb_searchStats__ = new SearchStatistics()
}
if (!globalThis.__kb_llmStats__) {
  globalThis.__kb_llmStats__ = new LLMStatistics()
}
if (!globalThis.__kb_embeddingStats__) {
  globalThis.__kb_embeddingStats__ = new EmbeddingStatistics()
}
if (!globalThis.__kb_mcpStats__) {
  globalThis.__kb_mcpStats__ = new MCPStatistics()
}

export const searchStats = globalThis.__kb_searchStats__
export const llmStats = globalThis.__kb_llmStats__
export const embeddingStats = globalThis.__kb_embeddingStats__
export const mcpStats = globalThis.__kb_mcpStats__