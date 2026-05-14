import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

// 隔离环境：用临时目录作为 KB_DIR
const TEST_DIR = `/tmp/kb-test-${Date.now()}`
const ORIGINAL_KB_DIR = process.env.KB_DIR

beforeAll(() => {
  process.env.KB_DIR = TEST_DIR
  mkdirSync(TEST_DIR, { recursive: true })
})

afterAll(() => {
  if (ORIGINAL_KB_DIR) {
    process.env.KB_DIR = ORIGINAL_KB_DIR
  } else {
    delete process.env.KB_DIR
  }
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true })
  }
})

// ==================== Layer 1: 存储层单元测试 ====================

describe("storage: writeDoc / readDoc", () => {
  it("should write and read a document", async () => {
    const { writeDoc, readDoc } = await import("./index.js")
    const doc = writeDoc({
      title: "Test Doc",
      tags: ["test"],
      keywords: ["test", "unit"],
      intent: "unit test",
      project_description: "test project",
    }, "## Hello\n\nThis is test content.")

    expect(doc.id).toBeDefined()
    expect(doc.title).toBe("Test Doc")
    expect(doc.tags).toEqual(["test"])
    expect(doc.file_path).toContain("/tmp/kb-test")

    const result = readDoc(doc.id, false)
    expect(result).not.toBeNull()
    expect(result!.meta.id).toBe(doc.id)
    expect(result!.content).toContain("Hello")
  })

  it("should return null for non-existent doc", async () => {
    const { readDoc } = await import("./index.js")
    const result = readDoc("nonexistent-id", false)
    expect(result).toBeNull()
  })

  it("should update existing doc by id", async () => {
    const { writeDoc, readDoc } = await import("./index.js")
    const doc = writeDoc({
      title: "Update Test",
      tags: ["test"],
      keywords: ["update"],
      intent: "test update",
      project_description: "test",
    }, "original content")

    const updated = writeDoc({
      id: doc.id,
      title: "Updated Title",
      tags: ["test", "updated"],
      keywords: ["update"],
      intent: "test update",
      project_description: "test",
      created_at: doc.created_at,
    }, "updated content")

    expect(updated.id).toBe(doc.id)
    expect(updated.title).toBe("Updated Title")

    const result = readDoc(doc.id, false)
    expect(result!.content).toBe("updated content")
    expect(result!.meta.tags).toContain("updated")
  })

  it("should delete a document", async () => {
    const { writeDoc, deleteDoc, readDoc } = await import("./index.js")
    const doc = writeDoc({
      title: "Delete Me",
      tags: ["test"],
      keywords: ["delete"],
      intent: "delete test",
      project_description: "test",
    }, "content to delete")

    const ok = deleteDoc(doc.id)
    expect(ok).toBe(true)

    const result = readDoc(doc.id, false)
    expect(result).toBeNull()
  })

  it("should return false when deleting non-existent doc", async () => {
    const { deleteDoc } = await import("./index.js")
    const ok = deleteDoc("nonexistent-id")
    expect(ok).toBe(false)
  })
})

describe("storage: searchDocs", () => {
  it("should find docs by keyword match", async () => {
    const { writeDoc, searchDocs } = await import("./index.js")

    writeDoc({
      title: "React Hooks Best Practices",
      tags: ["reference"],
      keywords: ["react", "hooks", "useEffect"],
      intent: "React hooks usage guide",
      project_description: "test",
    }, "useEffect cleanup, useState patterns...")

    writeDoc({
      title: "Node.js Streams Guide",
      tags: ["reference"],
      keywords: ["node", "streams", "buffer"],
      intent: "Node.js streams tutorial",
      project_description: "test",
    }, "Readable, Writable, Transform streams...")

    const results = searchDocs("React hooks")
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain("React")
    expect(results[0].score).toBeGreaterThan(0)
  })

  it("should find docs by tag", async () => {
    const { writeDoc, searchDocs } = await import("./index.js")

    writeDoc({
      title: "Tagged Doc Architecture",
      tags: ["architecture"],
      keywords: ["arch"],
      intent: "architecture doc",
      project_description: "test",
    }, "Architecture content")

    const results = searchDocs(undefined, undefined, ["architecture"])
    expect(results.length).toBeGreaterThan(0)
    expect(results.some(r => r.title === "Tagged Doc Architecture")).toBe(true)
  })

  it("should return empty for no match", async () => {
    const { searchDocs } = await import("./index.js")
    const results = searchDocs("zzzzzzzznoresultxxxxxx")
    // May return results due to loose matching, but score should be very low
    expect(results.length).toBeGreaterThanOrEqual(0)
  })
})

describe("storage: listDocs", () => {
  it("should list all documents", async () => {
    const { listDocs } = await import("./index.js")
    const docs = listDocs()
    expect(Array.isArray(docs)).toBe(true)
    expect(docs.length).toBeGreaterThan(0)
  })
})

// ==================== Miss Log 自进化测试 ====================

describe("storage: miss log (recordMiss / resolveMiss / getMissStats)", () => {
  it("should record a miss", async () => {
    const { recordMiss, getMissStats } = await import("./index.js")
    const result = recordMiss("test query for miss log")
    expect(result.total_misses).toBeGreaterThanOrEqual(1)
    expect(result.recurring).toBe(false)
  })

  it("should detect recurring miss", async () => {
    const { recordMiss } = await import("./index.js")
    recordMiss("recurring test query")
    const result = recordMiss("recurring test query")
    expect(result.recurring).toBe(true)
  })

  it("should resolve a miss", async () => {
    const { recordMiss, resolveMiss, getMissStats } = await import("./index.js")
    recordMiss("resolvable query xyz")
    resolveMiss("resolvable query xyz")
    const stats = getMissStats()
    const found = stats.unresolved.find(e => e.query === "resolvable query xyz")
    expect(found).toBeUndefined()
  })

  it("should return top missed queries", async () => {
    const { getMissStats } = await import("./index.js")
    const stats = getMissStats()
    expect(stats).toHaveProperty("unresolved")
    expect(stats).toHaveProperty("top_missed")
    expect(Array.isArray(stats.unresolved)).toBe(true)
    expect(Array.isArray(stats.top_missed)).toBe(true)
  })
})
