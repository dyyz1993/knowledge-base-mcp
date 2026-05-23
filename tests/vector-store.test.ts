import { test, expect, describe, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"

const TEST_KB_DIR = join(process.env.HOME || "/tmp", ".kb-test-vectorstore")

describe("vector-store", () => {
  const originalKbDir = process.env.KB_DIR

  beforeEach(() => {
    process.env.KB_DIR = TEST_KB_DIR
    if (existsSync(TEST_KB_DIR)) rmSync(TEST_KB_DIR, { recursive: true })
    mkdirSync(TEST_KB_DIR, { recursive: true })
  })

  afterEach(async () => {
    const { resetDb } = await import("../src/search/vector-store")
    resetDb()
    process.env.KB_DIR = originalKbDir
    if (existsSync(TEST_KB_DIR)) rmSync(TEST_KB_DIR, { recursive: true })
  })

  describe("encodeVector / decodeVector", () => {
    test("should correctly encode and decode a float32 vector", () => {
      const vec = [0.1, 0.2, 0.3, 0.4, 0.5]
      const encoded = new Uint8Array(new Float32Array(vec).buffer)
      const decoded = new Float32Array(encoded.buffer, encoded.byteOffset, encoded.byteLength / 4)

      expect(decoded.length).toBe(5)
      for (let i = 0; i < vec.length; i++) {
        expect(Math.abs(decoded[i] - vec[i])).toBeLessThan(0.001)
      }
    })

    test("should handle zero vector", () => {
      const vec = [0, 0, 0]
      const encoded = new Uint8Array(new Float32Array(vec).buffer)
      const decoded = new Float32Array(encoded.buffer, encoded.byteOffset, encoded.byteLength / 4)

      for (let i = 0; i < vec.length; i++) {
        expect(decoded[i]).toBe(0)
      }
    })

    test("should handle negative values", () => {
      const vec = [-1.5, -0.5, 0.5, 1.5]
      const encoded = new Uint8Array(new Float32Array(vec).buffer)
      const decoded = new Float32Array(encoded.buffer, encoded.byteOffset, encoded.byteLength / 4)

      for (let i = 0; i < vec.length; i++) {
        expect(Math.abs(decoded[i] - vec[i])).toBeLessThan(0.001)
      }
    })
  })

  describe("cosine similarity (cosim)", () => {
    function cosim(a: number[], b: number[]): number {
      let dot = 0, na = 0, nb = 0
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
      }
      return dot / (Math.sqrt(na) * Math.sqrt(nb))
    }

    test("should return 1 for identical vectors", () => {
      const vec = [1, 2, 3]
      expect(cosim(vec, vec)).toBeCloseTo(1.0, 5)
    })

    test("should return 0 for orthogonal vectors", () => {
      const a = [1, 0, 0]
      const b = [0, 1, 0]
      expect(cosim(a, b)).toBeCloseTo(0.0, 5)
    })

    test("should return -1 for opposite vectors", () => {
      const a = [1, 0, 0]
      const b = [-1, 0, 0]
      expect(cosim(a, b)).toBeCloseTo(-1.0, 5)
    })

    test("should handle different magnitudes", () => {
      const a = [1, 0, 0]
      const b = [5, 0, 0]
      expect(cosim(a, b)).toBeCloseTo(1.0, 5)
    })

    test("should compute similarity for multi-dimensional vectors", () => {
      const a = [0.1, 0.2, 0.3, 0.4]
      const b = [0.4, 0.3, 0.2, 0.1]
      const sim = cosim(a, b)
      expect(sim).toBeGreaterThan(0)
      expect(sim).toBeLessThan(1)
    })
  })

  describe("loadVectors / saveVectors", () => {
    test("should save and load vectors correctly", async () => {
      const { saveVectors, loadVectors, resetDb } = await import("../src/search/vector-store")

      const vectors = {
        "doc-1": [0.1, 0.2, 0.3],
        "doc-2": [0.4, 0.5, 0.6],
      }

      saveVectors(vectors)
      const loaded = loadVectors()

      expect(Object.keys(loaded)).toHaveLength(2)
      expect(loaded["doc-1"].length).toBe(3)
      expect(Math.abs(loaded["doc-1"][0] - 0.1)).toBeLessThan(0.001)
      expect(Math.abs(loaded["doc-2"][2] - 0.6)).toBeLessThan(0.001)
    })

    test("should overwrite existing vectors on save", async () => {
      const { saveVectors, loadVectors } = await import("../src/search/vector-store")

      saveVectors({ "doc-1": [0.1, 0.2, 0.3] })
      saveVectors({ "doc-1": [0.9, 0.8, 0.7] })

      const loaded = loadVectors()
      expect(Math.abs(loaded["doc-1"][0] - 0.9)).toBeLessThan(0.001)
    })

    test("should return empty object when no vectors exist", async () => {
      const { loadVectors } = await import("../src/search/vector-store")

      const loaded = loadVectors()
      expect(Object.keys(loaded)).toHaveLength(0)
    })
  })

  describe("getVectorCount", () => {
    test("should return 0 for empty store", async () => {
      const { getVectorCount } = await import("../src/search/vector-store")

      expect(getVectorCount()).toBe(0)
    })

    test("should return correct count after adding vectors", async () => {
      const { saveVectors, getVectorCount } = await import("../src/search/vector-store")

      saveVectors({
        "doc-1": [0.1, 0.2],
        "doc-2": [0.3, 0.4],
        "doc-3": [0.5, 0.6],
      })

      expect(getVectorCount()).toBe(3)
    })
  })

  describe("getStorageStats", () => {
    test("should return stats with zero count for empty store", async () => {
      const { getStorageStats } = await import("../src/search/vector-store")

      const stats = getStorageStats()
      expect(stats.count).toBe(0)
      expect(stats.dbSize).toBeGreaterThan(0)
    })

    test("should return correct count after adding vectors", async () => {
      const { saveVectors, getStorageStats } = await import("../src/search/vector-store")

      saveVectors({ "doc-1": [0.1, 0.2] })

      const stats = getStorageStats()
      expect(stats.count).toBe(1)
      expect(stats.dbSize).toBeGreaterThan(0)
    })
  })

  describe("getAllEmbeddings", () => {
    test("should return embeddings for matching docs", async () => {
      const { saveVectors, getAllEmbeddings } = await import("../src/search/vector-store")

      saveVectors({
        "doc-1": [0.1, 0.2, 0.3],
        "doc-2": [0.4, 0.5, 0.6],
      })

      const docs = [
        { id: "doc-1", title: "A", tags: [], keywords: [] },
        { id: "doc-2", title: "B", tags: [], keywords: [] },
      ]

      const results = getAllEmbeddings(docs as any)
      expect(results).toHaveLength(2)
      expect(results[0].meta.id).toBe("doc-1")
      expect(results[0].embedding.length).toBe(3)
    })

    test("should skip docs without embeddings", async () => {
      const { saveVectors, getAllEmbeddings } = await import("../src/search/vector-store")

      saveVectors({ "doc-1": [0.1, 0.2] })

      const docs = [
        { id: "doc-1", title: "A", tags: [], keywords: [] },
        { id: "doc-missing", title: "B", tags: [], keywords: [] },
      ]

      const results = getAllEmbeddings(docs as any)
      expect(results).toHaveLength(1)
      expect(results[0].meta.id).toBe("doc-1")
    })
  })

  describe("initDb", () => {
    test("should initialize database without error", async () => {
      const { initDb, resetDb } = await import("../src/search/vector-store")

      expect(() => initDb()).not.toThrow()
    })
  })
})
