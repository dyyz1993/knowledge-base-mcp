import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import YAML from "yaml"
import { getKbDir } from "../config"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("storage:miss-log")

function getMissLogPath(): string { return `${getKbDir()}/miss-log.json` }

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

let writing = false
const pendingWrites: Array<() => void> = []

function serializedWrite(fn: () => void): void {
  if (!writing) {
    writing = true
    try {
      fn()
    } finally {
      writing = false
      while (pendingWrites.length > 0) {
        const next = pendingWrites.shift()!
        writing = true
        try { next() } finally { writing = false }
      }
    }
  } else {
    pendingWrites.push(fn)
  }
}

interface MissEntry {
  query: string
  timestamp: number
  resolved: boolean
}

function readMissLog(): MissEntry[] {
  try {
    if (!existsSync(getMissLogPath())) return []
    return JSON.parse(readFileSync(getMissLogPath(), "utf-8"))
  } catch (e) {
    logger.warn("readMissLog: failed to read miss log:", e instanceof Error ? e.message : String(e))
    return []
  }
}

function writeMissLog(log: MissEntry[]) {
  ensureDir(getKbDir())
  serializedWrite(() => {
    const tmpPath = getMissLogPath() + ".tmp"
    writeFileSync(tmpPath, JSON.stringify(log, null, 2))
    renameSync(tmpPath, getMissLogPath())
  })
}

export function recordMiss(query: string): { total_misses: number; recurring: boolean } {
  let log = readMissLog()
  const existing = log.find(e => e.query.toLowerCase() === query.toLowerCase())
  const recurring = !!existing
  if (existing) {
    existing.timestamp = Date.now()
  } else {
    log.push({ query, timestamp: Date.now(), resolved: false })
  }
  if (log.length > 1000) {
    log = log.slice(-500)
  }
  writeMissLog(log)
  const unresolved = log.filter(e => !e.resolved)
  return { total_misses: unresolved.length, recurring }
}

export function resolveMiss(query: string): void {
  const log = readMissLog()
  const entry = log.find(e => e.query.toLowerCase() === query.toLowerCase())
  if (entry) {
    entry.resolved = true
    writeMissLog(log)
  }
}

export function getMissStats(limit = 20): { unresolved: MissEntry[]; top_missed: { query: string; count: number }[] } {
  const log = readMissLog()
  const unresolved = log.filter(e => !e.resolved).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit)

  const countMap: Record<string, number> = {}
  for (const e of log) {
    if (!e.resolved) {
      const key = e.query.toLowerCase()
      countMap[key] = (countMap[key] || 0) + 1
    }
  }
  const topMissed = Object.entries(countMap)
    .map(([query, count]) => ({ query, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)

  return { unresolved, top_missed: topMissed }
}
