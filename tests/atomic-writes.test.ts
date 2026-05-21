import { describe, test, expect, afterAll, beforeEach } from "bun:test"
import {
  existsSync,
  rmSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  renameSync,
} from "node:fs"
import { join } from "node:path"

const TEST_DIR = `/tmp/kb-test-atomic-${Math.random().toString(36).slice(2)}`
const INDEX_PATH = join(TEST_DIR, "index.json")
const MISS_LOG_PATH = join(TEST_DIR, "miss-log.json")

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
  mkdirSync(TEST_DIR, { recursive: true })
})

describe("atomicWriteIndex", () => {
  test("writes tmp file then renames to target, content matches", () => {
    ensureDir(TEST_DIR)

    const idx = { version: 1, documents: { doc1: { id: "doc1", title: "Test Doc" } } }
    const tmpPath = INDEX_PATH + ".tmp"
    writeFileSync(tmpPath, JSON.stringify(idx, null, 2))
    renameSync(tmpPath, INDEX_PATH)

    expect(existsSync(INDEX_PATH)).toBe(true)
    expect(existsSync(INDEX_PATH + ".tmp")).toBe(false)

    const written = JSON.parse(readFileSync(INDEX_PATH, "utf-8"))
    expect(written).toEqual(idx)
  })
})

describe("serializedWrite", () => {
  test("multiple calls execute sequentially", () => {
    let writing = false
    const pendingWrites: Array<() => void> = []
    const order: number[] = []

    function serializedWrite(fn: () => void): void {
      if (!writing) {
        writing = true
        try {
          fn()
        } finally {
          writing = false
          const next = pendingWrites.shift()
          if (next) serializedWrite(next)
        }
      } else {
        pendingWrites.push(fn)
      }
    }

    ensureDir(TEST_DIR)
    const filePath = join(TEST_DIR, "order.txt")

    serializedWrite(() => {
      order.push(1)
      writeFileSync(filePath, "first\n", { flag: "a" })
    })
    serializedWrite(() => {
      order.push(2)
      writeFileSync(filePath, "second\n", { flag: "a" })
    })
    serializedWrite(() => {
      order.push(3)
      writeFileSync(filePath, "third\n", { flag: "a" })
    })

    expect(order).toEqual([1, 2, 3])
    const content = readFileSync(filePath, "utf-8")
    expect(content).toBe("first\nsecond\nthird\n")
  })

  test("nested/recursive drain processes all pending writes", () => {
    let writing = false
    const pendingWrites: Array<() => void> = []
    const results: string[] = []

    function serializedWrite(fn: () => void): void {
      if (!writing) {
        writing = true
        try {
          fn()
        } finally {
          writing = false
          const next = pendingWrites.shift()
          if (next) serializedWrite(next)
        }
      } else {
        pendingWrites.push(fn)
      }
    }

    serializedWrite(() => { results.push("a") })
    serializedWrite(() => { results.push("b") })
    serializedWrite(() => { results.push("c") })

    expect(results).toEqual(["a", "b", "c"])
  })
})

describe("saveConfig (tmp+rename pattern)", () => {
  test("writes config via tmp+rename, file is valid JSON", () => {
    ensureDir(TEST_DIR)
    const configPath = join(TEST_DIR, "config.json")

    const config = {
      embedding: { provider: "local", enabled: false },
      search: { mode: "tfidf", minScore: 5 },
    }
    const tmpPath = configPath + ".tmp"
    writeFileSync(tmpPath, JSON.stringify(config, null, 2), "utf-8")
    renameSync(tmpPath, configPath)

    expect(existsSync(configPath)).toBe(true)
    expect(existsSync(configPath + ".tmp")).toBe(false)

    const written = JSON.parse(readFileSync(configPath, "utf-8"))
    expect(written).toEqual(config)
  })
})

describe("writeMissLog (serializedWrite + tmp+rename)", () => {
  test("writes miss log with tmp+rename, content is valid JSON", () => {
    ensureDir(TEST_DIR)

    const log = [
      { query: "how to deploy", timestamp: Date.now(), resolved: false },
      { query: "bun test setup", timestamp: Date.now(), resolved: false },
    ]

    let writing = false
    const pendingWrites: Array<() => void> = []

    function serializedWrite(fn: () => void): void {
      if (!writing) {
        writing = true
        try {
          fn()
        } finally {
          writing = false
          const next = pendingWrites.shift()
          if (next) serializedWrite(next)
        }
      } else {
        pendingWrites.push(fn)
      }
    }

    serializedWrite(() => {
      const tmpPath = MISS_LOG_PATH + ".tmp"
      writeFileSync(tmpPath, JSON.stringify(log, null, 2))
      renameSync(tmpPath, MISS_LOG_PATH)
    })

    expect(existsSync(MISS_LOG_PATH)).toBe(true)
    expect(existsSync(MISS_LOG_PATH + ".tmp")).toBe(false)

    const written = JSON.parse(readFileSync(MISS_LOG_PATH, "utf-8"))
    expect(written).toHaveLength(2)
    expect(written[0].query).toBe("how to deploy")
    expect(written[0].resolved).toBe(false)
  })
})

describe("Recovery from .md files when index.json is deleted", () => {
  test("readIndex recovers from .md files on disk", () => {
    ensureDir(TEST_DIR)

    const md1 = [
      "---",
      `id: "abc1234567"`,
      `title: "Recovered Doc One"`,
      `tags: ["test"]`,
      `keywords: ["recovery"]`,
      `intent: "Test recovery"`,
      `project_description: "test project"`,
      `created_at: 1700000000000`,
      `file_path: "${join(TEST_DIR, "abc1234567-recovered-doc-one.md")}"`,
      "---",
      "This is the body of doc one.",
    ].join("\n")

    const md2 = [
      "---",
      `id: "def7654321"`,
      `title: "Recovered Doc Two"`,
      `tags: ["test"]`,
      `keywords: ["recovery"]`,
      `intent: "Test recovery two"`,
      `project_description: "test project"`,
      `created_at: 1700000001000`,
      `file_path: "${join(TEST_DIR, "def7654321-recovered-doc-two.md")}"`,
      "---",
      "This is the body of doc two.",
    ].join("\n")

    writeFileSync(join(TEST_DIR, "abc1234567-recovered-doc-one.md"), md1)
    writeFileSync(join(TEST_DIR, "def7654321-recovered-doc-two.md"), md2)

    function parseFrontmatterWithMeta(raw: string): { frontmatter: Record<string, unknown> | null; content: string } {
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
      if (!match) return { frontmatter: null, content: raw }

      const fm: Record<string, unknown> = {}
      const fmText = match[1]
      let currentKey = ""
      let currentArr: unknown[] = []

      for (const line of fmText.split("\n")) {
        const kvMatch = line.match(/^(\w+):\s*["']?(.+?)["']?\s*$/)
        if (kvMatch) {
          if (currentKey && currentArr.length > 0) {
            fm[currentKey] = currentArr
            currentArr = []
          }
          currentKey = kvMatch[1]
          fm[currentKey] = kvMatch[2]
        } else if (line.match(/^\s+-\s+(.+)/)) {
          const val = line.match(/^\s+-\s+(.+)/)![1].replace(/^["']|["']$/g, "")
          currentArr.push(val)
        }
      }
      if (currentKey && currentArr.length > 0) {
        fm[currentKey] = currentArr
      }

      return { frontmatter: fm, content: match[2] }
    }

    function recoverIndexFromDisk(dir: string): { version: number; documents: Record<string, any> } | null {
      const files = readdirSync(dir).filter(f => f.endsWith(".md"))
      if (files.length === 0) return null

      const idx = { version: 1, documents: {} as Record<string, any> }
      for (const file of files) {
        try {
          const raw = readFileSync(join(dir, file), "utf-8")
          const { frontmatter } = parseFrontmatterWithMeta(raw)
          if (frontmatter?.id && frontmatter?.title) {
            idx.documents[frontmatter.id as string] = frontmatter
          }
        } catch {}
      }
      return idx
    }

    const recovered = recoverIndexFromDisk(TEST_DIR)
    expect(recovered).not.toBeNull()
    expect(Object.keys(recovered!.documents)).toHaveLength(2)
    expect(recovered!.documents["abc1234567"].title).toBe("Recovered Doc One")
    expect(recovered!.documents["def7654321"].title).toBe("Recovered Doc Two")
  })
})
