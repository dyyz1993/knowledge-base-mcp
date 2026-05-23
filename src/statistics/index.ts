import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { join } from "node:path"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("statistics:index")
const STATS_DIR = `${process.env.HOME}/.kb-chat/stats`
const SEARCH_STATS_PATH = `${STATS_DIR}/search.json`
const LLM_STATS_PATH = `${STATS_DIR}/llm.json`
const EMBEDDING_STATS_PATH = `${STATS_DIR}/embedding.json`
const MCP_STATS_PATH = `${STATS_DIR}/mcp.json`

// Debounced write: coalesces rapid calls into a single write every 10s
const _flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
function debouncedWrite(path: string, data: string) {
  const existing = _flushTimers.get(path)
  if (existing) clearTimeout(existing)
  _flushTimers.set(path, setTimeout(() => {
    _flushTimers.delete(path)
    try {
      const tmp = path + ".tmp"
      writeFileSync(tmp, data)
      renameSync(tmp, path)
    } catch { /* ignore write errors */ }
  }, 10_000))
}

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
  totalResults: number
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
      } catch (e) {
        logger.warn("Failed to load search stats, using defaults:", e instanceof Error ? e.message : String(e))
      }
    }
  }

  public save() {
    this.stats.updatedAt = Date.now()
    debouncedWrite(SEARCH_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  /** Force immediate write to disk (for shutdown) */
  public saveNow() {
    this.stats.updatedAt = Date.now()
    const tmp = SEARCH_STATS_PATH + ".tmp"
    writeFileSync(tmp, JSON.stringify(this.stats, null, 2))
    renameSync(tmp, SEARCH_STATS_PATH)
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

    logger.debug(`Search source: ${name} | call #${source.count} | ${count} results | ${timeMs}ms | avg: ${source.avgTime.toFixed(1)}ms`)

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
      } catch (e) {
        logger.warn("Failed to load LLM stats, using defaults:", e instanceof Error ? e.message : String(e))
      }
    }
  }

  public save() {
    this.stats.updatedAt = Date.now()
    debouncedWrite(LLM_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  public saveNow() {
    this.stats.updatedAt = Date.now()
    const tmp = LLM_STATS_PATH + ".tmp"
    writeFileSync(tmp, JSON.stringify(this.stats, null, 2))
    renameSync(tmp, LLM_STATS_PATH)
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

    logger.debug(`LLM: ${model} | call #${modelStats.count} | ${tokens} tokens | ${timeMs}ms | cost: $${cost.toFixed(4)}`)

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
      } catch (e) {
        logger.warn("Failed to load embedding stats, using defaults:", e instanceof Error ? e.message : String(e))
      }
    }
  }

  public save() {
    this.stats.updatedAt = Date.now()
    debouncedWrite(EMBEDDING_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  public saveNow() {
    this.stats.updatedAt = Date.now()
    const tmp = EMBEDDING_STATS_PATH + ".tmp"
    writeFileSync(tmp, JSON.stringify(this.stats, null, 2))
    renameSync(tmp, EMBEDDING_STATS_PATH)
  }

  recordCall(tokens: number, timeMs: number) {
    this.stats.count++
    this.stats.totalTokens += tokens
    this.stats.totalTime += timeMs
    this.stats.avgTime = this.stats.totalTime / this.stats.count
    this.stats.lastCalledAt = Date.now()

    logger.debug(`Embedding: call #${this.stats.count} | ${tokens} tokens | ${timeMs}ms`)

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
      } catch (e) {
        logger.warn("Failed to load MCP stats, using defaults:", e instanceof Error ? e.message : String(e))
      }
    }
  }

  public save() {
    this.stats.updatedAt = Date.now()
    debouncedWrite(MCP_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  public saveNow() {
    this.stats.updatedAt = Date.now()
    const tmp = MCP_STATS_PATH + ".tmp"
    writeFileSync(tmp, JSON.stringify(this.stats, null, 2))
    renameSync(tmp, MCP_STATS_PATH)
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

    logger.debug(`MCP tool: ${name} | call #${tool.count} | ${timeMs}ms | avg: ${tool.avgTime.toFixed(1)}ms`)

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

// Global singletons - initialized once per process
const _g = globalThis as Record<string, unknown>
if (!_g.__kb_searchStats__) {
  ensureStatsDir()
  _g.__kb_searchStats__ = new SearchStatistics()
}
if (!_g.__kb_llmStats__) {
  _g.__kb_llmStats__ = new LLMStatistics()
}
if (!_g.__kb_embeddingStats__) {
  _g.__kb_embeddingStats__ = new EmbeddingStatistics()
}
if (!_g.__kb_mcpStats__) {
  _g.__kb_mcpStats__ = new MCPStatistics()
}

export const searchStats = _g.__kb_searchStats__ as SearchStatistics
export const llmStats = _g.__kb_llmStats__ as LLMStatistics
export const embeddingStats = _g.__kb_embeddingStats__ as EmbeddingStatistics
export const mcpStats = _g.__kb_mcpStats__ as MCPStatistics

/** Flush all stats to disk on shutdown (immediate write, no debounce) */
export function flushStats(): void {
  try { searchStats.saveNow() } catch { /* ignore */ }
  try { llmStats.saveNow() } catch { /* ignore */ }
  try { embeddingStats.saveNow() } catch { /* ignore */ }
  try { mcpStats.saveNow() } catch { /* ignore */ }
}