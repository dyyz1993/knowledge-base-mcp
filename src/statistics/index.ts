import { readFile, writeFile, rename, mkdir } from "node:fs/promises"
import { access, constants } from "node:fs/promises"
import { join } from "node:path"
import { createLogger } from "../utils/logger.js"
import { getDataDir } from "../config"


const logger = createLogger("statistics:index")
const STATS_DIR = join(getDataDir(), "stats")
const SEARCH_STATS_PATH = `${STATS_DIR}/search.json`
const LLM_STATS_PATH = `${STATS_DIR}/llm.json`
const EMBEDDING_STATS_PATH = `${STATS_DIR}/embedding.json`
const MCP_STATS_PATH = `${STATS_DIR}/mcp.json`

const _flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
function debouncedWrite(path: string, data: string) {
  const existing = _flushTimers.get(path)
  if (existing) clearTimeout(existing)
  _flushTimers.set(path, setTimeout(async () => {
    _flushTimers.delete(path)
    try {
      const tmp = path + ".tmp"
      await writeFile(tmp, data)
      await rename(tmp, path)
    } catch { /* ignore write errors */ }
  }, 10_000))
}

async function ensureStatsDir() {
  try {
    await access(STATS_DIR, constants.F_OK)
  } catch {
    await mkdir(STATS_DIR, { recursive: true })
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
    void this.init()
  }

  private async init() {
    await ensureStatsDir()
    await this.load()
  }

  private async load() {
    try {
      await access(SEARCH_STATS_PATH, constants.F_OK)
      this.stats = JSON.parse(await readFile(SEARCH_STATS_PATH, "utf-8"))
    } catch (e) {
      if (e instanceof SyntaxError) {
        logger.warn("Failed to load search stats, using defaults:", e.message)
      }
    }
  }

  public save() {
    this.stats.updatedAt = Date.now()
    debouncedWrite(SEARCH_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  public async saveNow() {
    this.stats.updatedAt = Date.now()
    const tmp = SEARCH_STATS_PATH + ".tmp"
    await writeFile(tmp, JSON.stringify(this.stats, null, 2))
    await rename(tmp, SEARCH_STATS_PATH)
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
    void this.init()
  }

  private async init() {
    await ensureStatsDir()
    await this.load()
  }

  private async load() {
    try {
      await access(LLM_STATS_PATH, constants.F_OK)
      this.stats = JSON.parse(await readFile(LLM_STATS_PATH, "utf-8"))
    } catch (e) {
      if (e instanceof SyntaxError) {
        logger.warn("Failed to load LLM stats, using defaults:", e.message)
      }
    }
  }

  public save() {
    this.stats.updatedAt = Date.now()
    debouncedWrite(LLM_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  public async saveNow() {
    this.stats.updatedAt = Date.now()
    const tmp = LLM_STATS_PATH + ".tmp"
    await writeFile(tmp, JSON.stringify(this.stats, null, 2))
    await rename(tmp, LLM_STATS_PATH)
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
    void this.init()
  }

  private async init() {
    await ensureStatsDir()
    await this.load()
  }

  private async load() {
    try {
      await access(EMBEDDING_STATS_PATH, constants.F_OK)
      this.stats = JSON.parse(await readFile(EMBEDDING_STATS_PATH, "utf-8"))
    } catch (e) {
      if (e instanceof SyntaxError) {
        logger.warn("Failed to load embedding stats, using defaults:", e.message)
      }
    }
  }

  public save() {
    this.stats.updatedAt = Date.now()
    debouncedWrite(EMBEDDING_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  public async saveNow() {
    this.stats.updatedAt = Date.now()
    const tmp = EMBEDDING_STATS_PATH + ".tmp"
    await writeFile(tmp, JSON.stringify(this.stats, null, 2))
    await rename(tmp, EMBEDDING_STATS_PATH)
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
    void this.init()
  }

  private async init() {
    await ensureStatsDir()
    await this.load()
  }

  private async load() {
    try {
      await access(MCP_STATS_PATH, constants.F_OK)
      this.stats = JSON.parse(await readFile(MCP_STATS_PATH, "utf-8"))
    } catch (e) {
      if (e instanceof SyntaxError) {
        logger.warn("Failed to load MCP stats, using defaults:", e.message)
      }
    }
  }

  public save() {
    this.stats.updatedAt = Date.now()
    debouncedWrite(MCP_STATS_PATH, JSON.stringify(this.stats, null, 2))
  }

  public async saveNow() {
    this.stats.updatedAt = Date.now()
    const tmp = MCP_STATS_PATH + ".tmp"
    await writeFile(tmp, JSON.stringify(this.stats, null, 2))
    await rename(tmp, MCP_STATS_PATH)
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

export async function flushStats(): Promise<void> {
  try { await searchStats.saveNow() } catch { /* ignore */ }
  try { await llmStats.saveNow() } catch { /* ignore */ }
  try { await embeddingStats.saveNow() } catch { /* ignore */ }
  try { await mcpStats.saveNow() } catch { /* ignore */ }
}