import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { existsSync, rmSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const testDir = `/tmp/kb-test-${Math.random().toString(36).slice(2)}`
process.env.KB_DIR = testDir

const storage = await import("../src/storage/index")
const markdown = await import("../src/storage/markdown")

const { writeDoc, readDoc, searchDocs, listDocs, deleteDoc, getOutline, updateOutline, generateId, slugify } = storage
const { parseFrontmatter, buildFrontmatter } = markdown

function cleanDir() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  mkdirSync(testDir, { recursive: true })
}

// Ensure KB_DIR points to our test dir before each test
beforeEach(() => {
  process.env.KB_DIR = testDir
  cleanDir()
})

afterAll(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
})

describe("slugify", () => {
  test("lowercases and replaces non-alphanumeric with dash", () => {
    expect(slugify("Hello World!")).toBe("hello-world")
  })

  test("max 60 chars", () => {
    expect(slugify("a".repeat(100)).length).toBe(60)
  })

  test("handles Chinese characters", () => {
    expect(slugify("你好世界")).toBe("你好世界")
  })

  test("removes leading/trailing dashes", () => {
    expect(slugify("---hello---")).toBe("hello")
  })

  test("mixed latin and chinese", () => {
    expect(slugify("React Hooks 最佳实践!")).toBe("react-hooks-最佳实践")
  })

  test("empty string", () => {
    expect(slugify("")).toBe("")
  })
})

describe("generateId", () => {
  test("returns 10-char string", () => {
    const id = generateId()
    expect(typeof id).toBe("string")
    expect(id.length).toBe(10)
  })

  test("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, generateId))
    expect(ids.size).toBe(100)
  })
})

describe("parseFrontmatter / buildFrontmatter", () => {
  function makeDoc(overrides: Record<string, unknown> = {}) {
    return {
      id: "abc123def4",
      title: "Test Doc",
      tags: ["tutorial", "guide"],
      keywords: ["test", "example"],
      intent: "Testing frontmatter",
      project_description: "Test project",
      source_project: "/tmp/project",
      source_worktree: "/tmp/worktree",
      created_at: 1700000000000,
      file_path: "/tmp/test.md",
      ...overrides,
    }
  }

  test("roundtrip: build then parse returns original data", () => {
    const original = makeDoc()
    const built = buildFrontmatter(original as any)
    const { meta } = parseFrontmatter(built + "\nSome content")

    expect(meta.id).toBe(original.id)
    expect(meta.title).toBe(original.title)
    expect(meta.tags).toEqual(original.tags)
    expect(meta.keywords).toEqual(original.keywords)
    expect(meta.intent).toBe(original.intent)
    expect(meta.project_description).toBe(original.project_description)
    expect(meta.source_project).toBe(original.source_project)
    expect(meta.source_worktree).toBe(original.source_worktree)
    expect(meta.created_at).toBe(original.created_at)
    expect(meta.file_path).toBe(original.file_path)
  })

  test("parse handles arrays correctly", () => {
    const doc = makeDoc({ tags: ["a", "b", "c"], keywords: ["x", "y"] })
    const { meta } = parseFrontmatter(buildFrontmatter(doc as any) + "\nContent")

    expect(Array.isArray(meta.tags)).toBe(true)
    expect(meta.tags).toEqual(["a", "b", "c"])
    expect(Array.isArray(meta.keywords)).toBe(true)
    expect(meta.keywords).toEqual(["x", "y"])
  })

  test("parse handles strings with special characters", () => {
    const doc = makeDoc({ title: 'Hello "World" & <Friends>', intent: "It's a test" })
    const { meta } = parseFrontmatter(buildFrontmatter(doc as any) + "\nContent")

    expect(meta.title).toBe('Hello "World" & <Friends>')
    expect(meta.intent).toBe("It's a test")
  })

  test("parse returns empty meta for no frontmatter", () => {
    const { meta, content } = parseFrontmatter("Just some content")
    expect(Object.keys(meta).length).toBe(0)
    expect(content).toBe("Just some content")
  })

  test("parse extracts content after frontmatter", () => {
    const doc = makeDoc()
    const { content } = parseFrontmatter(buildFrontmatter(doc as any) + "\nLine 1\nLine 2\nLine 3")
    expect(content).toBe("Line 1\nLine 2\nLine 3")
  })
})

describe("writeDoc", () => {
  beforeEach(cleanDir)

  test("creates file with correct frontmatter", () => {
    const doc = writeDoc({
      title: "Test Doc",
      tags: ["tutorial"],
      keywords: ["test"],
      intent: "Testing",
      project_description: "Test project",
      source_project: "/tmp/project",
      source_worktree: "/tmp/project",
    }, "Hello world")

    expect(existsSync(doc.file_path)).toBe(true)
    const raw = readFileSync(doc.file_path, "utf-8")
    expect(raw).toContain("title: \"Test Doc\"")
    expect(raw).toContain("Hello world")
  })

  test("returns correct DocMeta", () => {
    const doc = writeDoc({
      title: "Meta Test",
      tags: ["tutorial"],
      keywords: ["test"],
      intent: "Testing",
      project_description: "Test project",
      source_project: "/tmp/project",
      source_worktree: "/tmp/project",
    }, "Content")

    expect(doc.id).toBeDefined()
    expect(doc.id.length).toBe(10)
    expect(doc.title).toBe("Meta Test")
    expect(doc.file_path).toContain(testDir)
    expect(doc.created_at).toBeGreaterThan(0)
    expect(doc.tags).toEqual(["tutorial"])
    expect(doc.keywords).toEqual(["test"])
  })

  test("updates index.json", () => {
    const doc = writeDoc({
      title: "Indexed Doc",
      tags: ["guide"],
      keywords: ["index"],
      intent: "Test index",
      project_description: "Test",
      source_project: "/tmp/project",
      source_worktree: "/tmp/project",
    }, "Content")

    const idx = JSON.parse(readFileSync(join(testDir, "index.json"), "utf-8"))
    expect(idx.documents[doc.id]).toBeDefined()
    expect(idx.documents[doc.id].title).toBe("Indexed Doc")
  })

  test("updates project outline", () => {
    const project = "/tmp/my-project"
    writeDoc({
      title: "Outline Doc",
      tags: ["document"],
      keywords: ["outline"],
      intent: "Test outline",
      project_description: "Test",
      source_project: project,
      source_worktree: project,
    }, "Content")

    const outline = getOutline(project)
    expect(outline).not.toBeNull()
    expect(outline.docs.length).toBe(1)
    expect(outline.docs[0].title).toBe("Outline Doc")
  })

  test("uses provided id and created_at", () => {
    const fixedTime = 1700000000000
    const doc = writeDoc({
      id: "custom1234",
      title: "Custom ID",
      tags: [],
      keywords: [],
      intent: "Test",
      project_description: "Test",
      source_project: "/tmp/p",
      source_worktree: "/tmp/p",
      created_at: fixedTime,
    }, "Content")

    expect(doc.id).toBe("custom1234")
    expect(doc.created_at).toBe(fixedTime)
  })
})

describe("readDoc", () => {
  beforeEach(cleanDir)

  test("returns correct content and meta", () => {
    const written = writeDoc({
      title: "Read Test",
      tags: ["test"],
      keywords: ["read"],
      intent: "Test read",
      project_description: "Test",
      source_project: "/tmp/project",
      source_worktree: "/tmp/project",
    }, "Hello world")

    const result = readDoc(written.id)
    expect(result).not.toBeNull()
    expect(result!.meta.id).toBe(written.id)
    expect(result!.meta.title).toBe("Read Test")
    expect(result!.content).toBe("Hello world")
    expect(result!.truncated).toBe(false)
  })

  test("truncate=true cuts at 500 lines", () => {
    const longContent = Array.from({ length: 600 }, (_, i) => `Line ${i + 1}`).join("\n")
    const written = writeDoc({
      title: "Long Doc",
      tags: ["test"],
      keywords: ["long"],
      intent: "Test truncation",
      project_description: "Test",
      source_project: "/tmp/project",
      source_worktree: "/tmp/project",
    }, longContent)

    const truncated = readDoc(written.id, true)
    expect(truncated!.truncated).toBe(true)
    expect(truncated!.content.split("\n").length).toBe(500)

    const full = readDoc(written.id, false)
    expect(full!.truncated).toBe(false)
    expect(full!.content.split("\n").length).toBe(600)
  })

  test("truncate=false returns full content even if short", () => {
    const written = writeDoc({
      title: "Short Doc",
      tags: [],
      keywords: [],
      intent: "Test",
      project_description: "Test",
      source_project: "/tmp/p",
      source_worktree: "/tmp/p",
    }, "Short")

    const result = readDoc(written.id, false)
    expect(result!.truncated).toBe(false)
    expect(result!.content).toBe("Short")
  })

  test("returns null for non-existent id", () => {
    expect(readDoc("nonexistent")).toBeNull()
  })
})

describe("searchDocs", () => {
  beforeEach(cleanDir)

  function seedDocs() {
    writeDoc({
      title: "UniqueTitle ABC",
      tags: ["tag-alpha"],
      keywords: ["kw-alpha", "kw-shared"],
      intent: "UniqueIntent DEF",
      project_description: "UniqueProject GHI",
      source_project: "/tmp/project-alpha",
      source_worktree: "/tmp/project-alpha",
    }, "Alpha content")

    writeDoc({
      title: "OtherTitle JKL",
      tags: ["tag-beta"],
      keywords: ["kw-beta", "kw-shared"],
      intent: "OtherIntent MNO",
      project_description: "OtherProject PQR",
      source_project: "/tmp/project-beta",
      source_worktree: "/tmp/project-beta",
    }, "Beta content")

    writeDoc({
      title: "ThirdTitle STU",
      tags: ["tag-gamma", "tag-alpha"],
      keywords: ["kw-gamma"],
      intent: "ThirdIntent VWX",
      project_description: "ThirdProject YZ",
      source_project: "/tmp/project-gamma",
      source_worktree: "/tmp/project-gamma",
    }, "Gamma content")
  }

  test("matches by title with score=10", () => {
    seedDocs()
    const results = searchDocs("uniquetitle")
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("UniqueTitle ABC")
    expect(results[0].score).toBe(10)
  })

  test("matches by keywords with tokenized scoring", () => {
    seedDocs()
    const results = searchDocs("kw-alpha")
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("UniqueTitle ABC")
    expect(results[0].score).toBe(27)
  })

  test("matches by intent with score=5", () => {
    seedDocs()
    const results = searchDocs("uniqueintent")
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("UniqueTitle ABC")
    expect(results[0].score).toBe(5)
  })

  test("filters out low-scoring matches (project_description only, score=3)", () => {
    seedDocs()
    const results = searchDocs("uniqueproject")
    expect(results.length).toBe(0)
  })

  test("matches by tags filter with score=5", () => {
    seedDocs()
    const results = searchDocs(undefined, undefined, ["tag-beta"])
    expect(results.length).toBe(1)
    expect(results[0].title).toBe("OtherTitle JKL")
    expect(results[0].score).toBe(5)
  })

  test("filters out low-scoring matches (keywords filter only, score=3)", () => {
    seedDocs()
    const results = searchDocs(undefined, ["kw-gamma"])
    expect(results.length).toBe(0)
  })

  test("combined query + tag score", () => {
    seedDocs()
    const results = searchDocs("uniquetitle", undefined, ["tag-alpha"])
    const docA = results.find(r => r.title === "UniqueTitle ABC")
    expect(docA).toBeDefined()
    expect(docA!.score).toBe(15) // title(10) + tag(5)
  })

  test("tag filter matches multiple docs", () => {
    seedDocs()
    const results = searchDocs(undefined, undefined, ["tag-alpha"])
    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.score).toBe(5)
    }
  })

  test("shared keyword matches multiple docs", () => {
    seedDocs()
    const results = searchDocs("kw-shared")
    expect(results.length).toBe(2)
    const docA = results.find(r => r.title === "UniqueTitle ABC")
    const docB = results.find(r => r.title === "OtherTitle JKL")
    expect(docA).toBeDefined()
    expect(docB).toBeDefined()
    expect(docA!.score).toBe(25)
    expect(docB!.score).toBe(25)
  })

  test("returns empty for no match", () => {
    seedDocs()
    expect(searchDocs("zzzznonexistent").length).toBe(0)
  })

  test("respects limit parameter", () => {
    seedDocs()
    const results = searchDocs(undefined, undefined, ["tag-alpha"], 1)
    expect(results.length).toBe(1)
  })

  test("results sorted by score desc", () => {
    seedDocs()
    const results = searchDocs("kw-shared", undefined, ["tag-alpha"])
    expect(results.length).toBe(3)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  test("empty query returns nothing without filters", () => {
    seedDocs()
    expect(searchDocs().length).toBe(0)
  })
})

describe("listDocs", () => {
  beforeEach(cleanDir)

  test("returns all docs sorted by created_at desc", () => {
    const d1 = writeDoc({
      title: "First",
      tags: ["a"],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/p1",
      source_worktree: "/tmp/p1",
      created_at: 1000,
    }, "C1")

    const d2 = writeDoc({
      title: "Second",
      tags: ["b"],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/p2",
      source_worktree: "/tmp/p2",
      created_at: 2000,
    }, "C2")

    const docs = listDocs().filter(d => [d1.id, d2.id].includes(d.id))
    expect(docs.length).toBe(2)
    expect(docs[0].id).toBe(d2.id)
    expect(docs[1].id).toBe(d1.id)
  })

  test("filters by tag", () => {
    writeDoc({
      title: "Tagged A",
      tags: ["alpha"],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/p",
      source_worktree: "/tmp/p",
    }, "C")

    writeDoc({
      title: "Tagged B",
      tags: ["beta"],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/p",
      source_worktree: "/tmp/p",
    }, "C")

    expect(listDocs("alpha").length).toBe(1)
    expect(listDocs("alpha")[0].title).toBe("Tagged A")
  })

  test("filters by project", () => {
    writeDoc({
      title: "Project A",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/proj-a",
      source_worktree: "/tmp/proj-a",
    }, "C")

    writeDoc({
      title: "Project B",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/proj-b",
      source_worktree: "/tmp/proj-b",
    }, "C")

    const result = listDocs(undefined, "/tmp/proj-a")
    expect(result.length).toBe(1)
    expect(result[0].title).toBe("Project A")
  })

  test("returns empty for no match", () => {
    writeDoc({
      title: "Doc",
      tags: ["x"],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/p",
      source_worktree: "/tmp/p",
    }, "C")

    expect(listDocs("nonexistent").length).toBe(0)
    expect(listDocs(undefined, "/nonexistent").length).toBe(0)
  })
})

describe("deleteDoc", () => {
  beforeEach(cleanDir)

  test("deletes file and removes from index", () => {
    const doc = writeDoc({
      title: "Delete Me",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/p",
      source_worktree: "/tmp/p",
    }, "Content")

    const filePath = doc.file_path
    expect(existsSync(filePath)).toBe(true)

    expect(deleteDoc(doc.id)).toBe(true)
    expect(existsSync(filePath)).toBe(false)
    expect(readDoc(doc.id)).toBeNull()
  })

  test("returns false for non-existent id", () => {
    expect(deleteDoc("nonexistent")).toBe(false)
  })

  test("updates outline after delete", () => {
    const project = "/tmp/outline-del"
    const doc = writeDoc({
      title: "Del Outline",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: project,
      source_worktree: project,
    }, "C")

    expect(getOutline(project)!.docs.length).toBe(1)

    deleteDoc(doc.id)
    const outline = getOutline(project)
    expect(outline!.docs.length).toBe(0)
  })

  test("does not affect other docs", () => {
    const d1 = writeDoc({
      title: "Keep",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/p",
      source_worktree: "/tmp/p",
    }, "C1")

    const d2 = writeDoc({
      title: "Remove",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: "/tmp/p",
      source_worktree: "/tmp/p",
    }, "C2")

    deleteDoc(d2.id)
    expect(readDoc(d1.id)).not.toBeNull()
    expect(readDoc(d2.id)).toBeNull()
  })
})

describe("getOutline", () => {
  beforeEach(cleanDir)

  test("returns null for project with no docs", () => {
    expect(getOutline("/tmp/no-such-project")).toBeNull()
  })

  test("returns correct outline structure", () => {
    const project = "/tmp/outline-struct"
    const doc = writeDoc({
      title: "Outline Doc",
      tags: ["guide"],
      keywords: ["outline"],
      intent: "T",
      project_description: "T",
      source_project: project,
      source_worktree: project,
    }, "C")

    const outline = getOutline(project)
    expect(outline).not.toBeNull()
    expect(outline.project).toBe(project)
    expect(outline.updated_at).toBeGreaterThan(0)
    expect(outline.docs.length).toBe(1)
    expect(outline.docs[0]).toEqual({
      id: doc.id,
      title: "Outline Doc",
      tags: ["guide"],
      keywords: ["outline"],
      intent: "T",
    })
  })
})

describe("updateOutline", () => {
  beforeEach(cleanDir)

  test("creates outline file", () => {
    const project = "/tmp/outline-create"
    writeDoc({
      title: "Doc 1",
      tags: ["a"],
      keywords: ["k1"],
      intent: "T",
      project_description: "T",
      source_project: project,
      source_worktree: project,
    }, "C")

    const outline = getOutline(project)
    expect(outline).not.toBeNull()
    expect(outline.docs.length).toBe(1)
  })

  test("groups docs by project", () => {
    const p1 = "/tmp/group-p1"
    const p2 = "/tmp/group-p2"

    writeDoc({
      title: "P1 Doc",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: p1,
      source_worktree: p1,
    }, "C")

    writeDoc({
      title: "P2 Doc",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: p2,
      source_worktree: p2,
    }, "C")

    expect(getOutline(p1)!.docs.length).toBe(1)
    expect(getOutline(p1)!.docs[0].title).toBe("P1 Doc")
    expect(getOutline(p2)!.docs.length).toBe(1)
    expect(getOutline(p2)!.docs[0].title).toBe("P2 Doc")
  })

  test("outline sorted by created_at desc", () => {
    const project = "/tmp/outline-sort"
    const d1 = writeDoc({
      title: "Old",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: project,
      source_worktree: project,
      created_at: 1000,
    }, "C")

    const d2 = writeDoc({
      title: "New",
      tags: [],
      keywords: [],
      intent: "T",
      project_description: "T",
      source_project: project,
      source_worktree: project,
      created_at: 2000,
    }, "C")

    const outline = getOutline(project)
    expect(outline.docs[0].id).toBe(d2.id)
    expect(outline.docs[1].id).toBe(d1.id)
  })
})
