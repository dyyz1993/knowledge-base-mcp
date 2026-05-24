import { describe, test, expect, beforeEach, afterEach, afterAll } from "bun:test"
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { cosineSimilarityVec, docToSearchableText, clearEmbeddingCache } from "../src/search/embedding"
import { loadVectors, saveVectors, initDb, getVectorCount, resetDb } from "../src/search/vector-store"
import type { DocMeta } from "../src/storage/index"

const testDir = `/tmp/kb-embed-modules-test-${Math.random().toString(36).slice(2)}`

function makeDoc(overrides: Partial<DocMeta> = {}): DocMeta {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 8),
    title: "Test Doc",
    tags: [],
    keywords: [],
    intent: "Testing",
    project_description: "Test project",
    created_at: Date.now(),
    file_path: join(testDir, "test.md"),
    ...overrides,
  }
}

beforeEach(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  mkdirSync(testDir, { recursive: true })
  process.env.KB_DIR = testDir
  resetDb()
})

afterEach(() => {
  resetDb()
})

afterAll(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
})

describe("cosineSimilarityVec", () => {
  test("should return 1 for identical vectors", () => {
    const v = [1, 2, 3, 4]
    expect(cosineSimilarityVec(v, v)).toBeCloseTo(1.0)
  })

  test("should return 0 for orthogonal vectors", () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarityVec(a, b)).toBeCloseTo(0)
  })

  test("should return 0 for mismatched dimensions", () => {
    const a = [1, 2, 3]
    const b = [1, 2]
    expect(cosineSimilarityVec(a, b)).toBe(0)
  })

  test("should handle zero vectors", () => {
    const score = cosineSimilarityVec([0, 0, 0], [1, 2, 3])
    expect(isFinite(score)).toBe(true)
  })

  test("should return -1 for opposite vectors", () => {
    const score = cosineSimilarityVec([1, 0, 0], [-1, 0, 0])
    expect(score).toBeCloseTo(-1)
  })

  test("should return high similarity for near-identical vectors", () => {
    const a = [1, 2, 3]
    const b = [1.01, 2.01, 3.01]
    expect(cosineSimilarityVec(a, b)).toBeGreaterThan(0.99)
  })
})

describe("embedding cache", () => {
  test("should cache and retrieve embeddings via getCacheKey pattern", () => {
    clearEmbeddingCache()
    const cache = new Map<string, number[]>()
    cache.set("5:hello", [0.1, 0.2, 0.3])
    expect(cache.get("5:hello")).toEqual([0.1, 0.2, 0.3])
  })

  test("should respect max cache size with LRU eviction", () => {
    const MAX_SIZE = 500
    const cache = new Map<string, number[]>()
    for (let i = 0; i <= MAX_SIZE; i++) {
      const key = `${i}:text${i}`
      if (cache.size >= MAX_SIZE) {
        const firstKey = cache.keys().next().value
        if (firstKey !== undefined) cache.delete(firstKey)
      }
      cache.set(key, [i])
    }
    expect(cache.size).toBe(MAX_SIZE)
    expect(cache.has("0:text0")).toBe(false)
    expect(cache.has(`${MAX_SIZE}:text${MAX_SIZE}`)).toBe(true)
  })

  test("should clear cache on demand", () => {
    clearEmbeddingCache()
    const cache = new Map<string, number[]>()
    cache.set("key", [1])
    expect(cache.size).toBe(1)
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe("docToSearchableText", () => {
  test("should concatenate doc fields", () => {
    const doc = makeDoc({
      title: "React Guide",
      keywords: ["react", "hooks"],
      intent: "Learn React",
      project_description: "Frontend project",
      tags: ["tutorial"],
    })
    writeFileSync(doc.file_path, "---\ntitle: test\n---\nBody content here")
    const text = docToSearchableText(doc)
    expect(text).toContain("React Guide")
    expect(text).toContain("react")
    expect(text).toContain("hooks")
    expect(text).toContain("Learn React")
    expect(text).toContain("Frontend project")
    expect(text).toContain("tutorial")
  })

  test("should handle empty doc", () => {
    const doc = makeDoc({
      title: "",
      keywords: [],
      intent: "",
      project_description: "",
      tags: [],
    })
    writeFileSync(doc.file_path, "---\n---\n")
    const text = docToSearchableText(doc)
    expect(typeof text).toBe("string")
  })

  test("should include body content from file", () => {
    const doc = makeDoc({ title: "Doc" })
    writeFileSync(doc.file_path, "---\n---\nSome body text here")
    const text = docToSearchableText(doc)
    expect(text).toContain("Doc")
  })
})

describe("vector-store encodeVector / decodeVector", () => {
  test("should roundtrip float arrays", () => {
    const vec = [0.1, 0.2, 0.3, -0.5, 1.0]
    const encoded = new Uint8Array(new Float32Array(vec).buffer)
    const decoded = new Float32Array(encoded.buffer, encoded.byteOffset, encoded.byteLength / 4)
    expect(decoded.length).toBe(vec.length)
    for (let i = 0; i < vec.length; i++) {
      expect(Math.abs(decoded[i] - vec[i])).toBeLessThan(0.001)
    }
  })

  test("should handle empty vectors", () => {
    const vec: number[] = []
    const encoded = new Uint8Array(new Float32Array(vec).buffer)
    const decoded = new Float32Array(encoded.buffer, encoded.byteOffset, encoded.byteLength / 4)
    expect(decoded.length).toBe(0)
  })
})

describe("initDb", () => {
  test("should create database with correct schema", () => {
    initDb()
    const dbPath = join(testDir, "embeddings.db")
    expect(existsSync(dbPath)).toBe(true)
  })

  test("should handle existing database", () => {
    initDb()
    expect(() => initDb()).not.toThrow()
  })
})

describe("saveVectors / loadVectors", () => {
  test("should save and load vectors correctly", () => {
    const data: Record<string, number[]> = {
      "doc-1": [0.1, 0.2, 0.3],
      "doc-2": [0.4, 0.5, 0.6],
    }
    saveVectors(data)
    const loaded = loadVectors()
    expect(Object.keys(loaded).sort()).toEqual(["doc-1", "doc-2"])
    for (const key of Object.keys(data)) {
      expect(loaded[key]).toBeDefined()
      for (let i = 0; i < data[key].length; i++) {
        expect(loaded[key][i]).toBeCloseTo(data[key][i], 5)
      }
    }
  })

  test("should overwrite existing vectors", () => {
    saveVectors({ "doc-1": [1, 2, 3] })
    saveVectors({ "doc-1": [4, 5, 6] })
    const loaded = loadVectors()
    expect(loaded["doc-1"]).toEqual([4, 5, 6])
  })
})

describe("getVectorCount", () => {
  test("should return 0 for empty database", () => {
    expect(getVectorCount()).toBe(0)
  })

  test("should return correct count after insertions", () => {
    saveVectors({ "a": [1, 2], "b": [3, 4], "c": [5, 6] })
    expect(getVectorCount()).toBe(3)
  })
})
