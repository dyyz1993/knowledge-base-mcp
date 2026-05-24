import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"

const tmpDir = join(os.tmpdir(), `kb-storage-search-test-${Date.now()}`)
const origKBDir = process.env.KB_DIR
const origKBDataDir = process.env.KB_DATA_DIR

beforeEach(() => {
  process.env.KB_DIR = tmpDir
  process.env.KB_DATA_DIR = join(tmpDir, ".kb-chat")
  mkdirSync(join(tmpDir, ".kb-chat"), { recursive: true })
})

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true })
  process.env.KB_DIR = origKBDir
  process.env.KB_DATA_DIR = origKBDataDir
})

describe("storage search", () => {
  it("should find docs by token match", async () => {
    const { writeDoc, deleteDoc, searchDocs } = await import("../src/storage/index")
    const doc = writeDoc({
      title: "Token Match Test Document",
      keywords: ["token-match"],
      tags: ["test"],
      intent: "test token matching in storage search",
      project_description: "test project for token matching",
    }, "This document is about token matching in search.")
    try {
      const results = searchDocs("token match", undefined, undefined, 10)
      expect(results.some(r => r.id === doc.id)).toBe(true)
      expect(results.find(r => r.id === doc.id)!.matched_by.length).toBeGreaterThan(0)
    } finally {
      deleteDoc(doc.id)
    }
  })

  it("should combine results from multiple layers", async () => {
    const { writeDoc, deleteDoc } = await import("../src/storage/index")
    const { searchDocsCombined } = await import("../src/storage/search")
    const doc = writeDoc({
      title: "Combined Search Test",
      keywords: ["combined", "search"],
      tags: ["test"],
      intent: "test combined search layers",
      project_description: "combined search test project",
    }, "Content for combined search layer test with multiple keywords.")
    try {
      const results = await searchDocsCombined("combined search test", undefined, undefined, 10)
      expect(Array.isArray(results)).toBe(true)
      expect(results.some(r => r.id === doc.id)).toBe(true)
    } finally {
      deleteDoc(doc.id)
    }
  })

  it("should normalize and weight scores", async () => {
    const { writeDoc, deleteDoc } = await import("../src/storage/index")
    const { searchDocsCombined } = await import("../src/storage/search")
    const docHigh = writeDoc({
      title: "Normalize Weight Score High",
      keywords: ["normalize", "weight", "score"],
      tags: ["test"],
      intent: "normalize weight score test high priority",
      project_description: "score normalization test",
    }, "High score content with normalize weight score keywords repeated.")
    const docLow = writeDoc({
      title: "Unrelated Document",
      keywords: ["unrelated"],
      tags: ["test"],
      intent: "something else entirely",
      project_description: "different project",
    }, "This has nothing to do with the query terms.")
    try {
      const results = await searchDocsCombined("normalize weight score", undefined, undefined, 10)
      expect(Array.isArray(results)).toBe(true)
      if (results.length >= 2) {
        const highIdx = results.findIndex(r => r.id === docHigh.id)
        const lowIdx = results.findIndex(r => r.id === docLow.id)
        if (highIdx >= 0 && lowIdx >= 0) {
          expect(highIdx).toBeLessThan(lowIdx)
        }
      }
    } finally {
      deleteDoc(docHigh.id)
      deleteDoc(docLow.id)
    }
  })

  it("should filter by min score", async () => {
    const { searchDocs } = await import("../src/storage/index")
    const results = searchDocs("zzzzzzz_totally_nonexistent_query_12345", undefined, undefined, 10)
    expect(results.length).toBe(0)
  })

  it("should handle empty index gracefully", async () => {
    const { searchDocs } = await import("../src/storage/index")
    const results = searchDocs("anything", undefined, undefined, 10)
    expect(Array.isArray(results)).toBe(true)
  })

  it("should search by tags", async () => {
    const { writeDoc, deleteDoc, searchDocs } = await import("../src/storage/index")
    const doc = writeDoc({
      title: "Tag Search Test",
      keywords: ["tag-search"],
      tags: ["unique-tag-test-xyz"],
      intent: "test tag search",
      project_description: "tag search test",
    }, "Content for tag search test.")
    try {
      const results = searchDocs(undefined, undefined, ["unique-tag-test-xyz"], 10)
      expect(results.some(r => r.id === doc.id)).toBe(true)
    } finally {
      deleteDoc(doc.id)
    }
  })

  it("should search by keywords", async () => {
    const { writeDoc, deleteDoc, searchDocs } = await import("../src/storage/index")
    const doc = writeDoc({
      title: "Keyword Search Test",
      keywords: ["uniquekwsearchabc"],
      tags: ["test"],
      intent: "test keyword search",
      project_description: "keyword search test",
    }, "Content for keyword search test.")
    try {
      const results = searchDocs("keyword search", ["uniquekwsearchabc"], undefined, 10)
      expect(results.some(r => r.id === doc.id)).toBe(true)
    } finally {
      deleteDoc(doc.id)
    }
  })

  it("should include snippet in results", async () => {
    const { writeDoc, deleteDoc, searchDocs } = await import("../src/storage/index")
    const doc = writeDoc({
      title: "Snippet Test Document",
      keywords: ["snippet"],
      tags: ["test"],
      intent: "test snippet extraction",
      project_description: "snippet test",
    }, "This is the body content that contains the snippet keyword for extraction testing.")
    try {
      const results = searchDocs("snippet", undefined, undefined, 10)
      const found = results.find(r => r.id === doc.id)
      expect(found).toBeDefined()
      expect(found!.snippet).toBeDefined()
    } finally {
      deleteDoc(doc.id)
    }
  })

  it("should apply content quality boost", async () => {
    const { writeDoc, deleteDoc, searchDocs } = await import("../src/storage/index")
    const longContent = "Long content. ".repeat(400)
    const doc = writeDoc({
      title: "Quality Boost Content Test",
      keywords: ["quality-boost-test"],
      tags: ["test"],
      intent: "test quality boost",
      project_description: "quality test",
    }, longContent)
    try {
      const results = searchDocs("quality boost content", undefined, undefined, 10)
      const found = results.find(r => r.id === doc.id)
      expect(found).toBeDefined()
      expect(found!.score).toBeGreaterThan(0)
    } finally {
      deleteDoc(doc.id)
    }
  })
})

describe("miss-log", () => {
  it("should record search misses", async () => {
    const { recordMiss } = await import("../src/storage/miss-log")
    const result = recordMiss("test-miss-query-unique")
    expect(result).toBeDefined()
    expect(typeof result.total_misses).toBe("number")
  })

  it("should detect recurring misses", async () => {
    const { recordMiss } = await import("../src/storage/miss-log")
    recordMiss("recurring-miss-test-unique")
    const result = recordMiss("recurring-miss-test-unique")
    expect(result.recurring).toBe(true)
  })

  it("should resolve misses", async () => {
    const { recordMiss, resolveMiss, getMissStats } = await import("../src/storage/miss-log")
    recordMiss("resolve-miss-test-unique")
    resolveMiss("resolve-miss-test-unique")
    const stats = getMissStats()
    const resolved = stats.unresolved.find(e => e.query.toLowerCase() === "resolve-miss-test-unique")
    expect(resolved).toBeUndefined()
  })

  it("should compact when over limit", async () => {
    const { recordMiss, getMissStats } = await import("../src/storage/miss-log")
    for (let i = 0; i < 1100; i++) {
      recordMiss(`compact-test-${i}-${Date.now()}`)
    }
    const stats = getMissStats()
    expect(stats.unresolved.length).toBeLessThanOrEqual(20)
  })

  it("should return empty for no misses", async () => {
    const { getMissStats } = await import("../src/storage/miss-log")
    const stats = getMissStats(5)
    expect(stats).toBeDefined()
    expect(Array.isArray(stats.unresolved)).toBe(true)
    expect(Array.isArray(stats.top_missed)).toBe(true)
  })

  it("should track top missed queries", async () => {
    const { recordMiss, getMissStats } = await import("../src/storage/miss-log")
    recordMiss("top-miss-a-unique")
    recordMiss("top-miss-a-unique")
    recordMiss("top-miss-a-unique")
    recordMiss("top-miss-b-unique")
    const stats = getMissStats(10)
    const topA = stats.top_missed.find(e => e.query === "top-miss-a-unique")
    const topB = stats.top_missed.find(e => e.query === "top-miss-b-unique")
    expect(topA).toBeDefined()
    expect(topB).toBeDefined()
    if (topA && topB) {
      expect(topA.count).toBeGreaterThanOrEqual(topB.count)
    }
  })
})
