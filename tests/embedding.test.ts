import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { existsSync, rmSync, mkdirSync } from "node:fs"
import { cosineSimilarityVec, docToSearchableText, semanticSearch, embed } from "../src/search/embedding"
import { loadVectors, saveVectors, indexDoc, indexAllDocs, getAllEmbeddings } from "../src/search/vector-store"
import type { DocMeta } from "../src/storage/index"
import { loadConfig } from "../src/config"

function getEmbeddingDim(): number {
  const config = loadConfig()
  return config.embedding.dimensions || 1024
}

const testDir = `/tmp/kb-embed-test-${Math.random().toString(36).slice(2)}`

if (existsSync(testDir)) rmSync(testDir, { recursive: true })
mkdirSync(testDir, { recursive: true })

process.env.KB_DIR = testDir

function makeDoc(overrides: Partial<DocMeta> = {}): DocMeta {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 8),
    title: "Test Doc",
    tags: [],
    keywords: [],
    intent: "Testing",
    project_description: "Test project",
    source_project: "/tmp/test",
    source_worktree: "/tmp/test",
    created_at: Date.now(),
    file_path: "/tmp/test.md",
    ...overrides,
  }
}

function cleanDir() {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
  mkdirSync(testDir, { recursive: true })
}

afterAll(() => {
  if (existsSync(testDir)) rmSync(testDir, { recursive: true })
})

let modelAvailable = false
let modelChecked = false

async function checkModel(): Promise<boolean> {
  if (modelChecked) return modelAvailable
  modelChecked = true
  try {
    await embed("test")
    modelAvailable = true
  } catch {
    modelAvailable = false
  }
  return modelAvailable
}

describe("cosineSimilarityVec", () => {
  test("identical vectors = 1.0", () => {
    const v = [1, 2, 3, 4]
    expect(cosineSimilarityVec(v, v)).toBeCloseTo(1.0)
  })

  test("orthogonal vectors ≈ 0", () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarityVec(a, b)).toBeCloseTo(0)
  })

  test("similar vectors have high similarity", () => {
    const a = [1, 2, 3]
    const b = [1.1, 2.1, 3.1]
    expect(cosineSimilarityVec(a, b)).toBeGreaterThan(0.99)
  })

  test("opposite vectors have negative similarity", () => {
    const a = [1, 0, 0]
    const b = [-1, 0, 0]
    expect(cosineSimilarityVec(a, b)).toBeCloseTo(-1)
  })

  test("zero vectors handled with epsilon", () => {
    const score = cosineSimilarityVec([0, 0, 0], [1, 2, 3])
    expect(isFinite(score)).toBe(true)
  })
})

describe("docToSearchableText", () => {
  test("concatenates title, keywords, intent, project_description, tags", () => {
    const doc = makeDoc({
      title: "React Guide",
      keywords: ["react", "hooks"],
      intent: "Learn React",
      project_description: "Frontend project",
      tags: ["tutorial"],
    })
    const text = docToSearchableText(doc)
    expect(text).toContain("React Guide")
    expect(text).toContain("react")
    expect(text).toContain("hooks")
    expect(text).toContain("Learn React")
    expect(text).toContain("Frontend project")
    expect(text).toContain("tutorial")
  })

  test("skips empty fields", () => {
    const doc = makeDoc({
      title: "Title",
      keywords: [],
      intent: "",
      project_description: "",
      tags: [],
    })
    const text = docToSearchableText(doc)
    expect(text).toBe("Title")
  })

  test("handles all empty fields", () => {
    const doc = makeDoc({
      title: "",
      keywords: [],
      intent: "",
      project_description: "",
      tags: [],
    })
    expect(docToSearchableText(doc)).toBe("")
  })
})

describe("vector-store", () => {
  beforeEach(cleanDir)

  test("loadVectors returns empty object when no file", () => {
    const v = loadVectors()
    expect(v).toEqual({})
  })

  test("saveVectors / loadVectors roundtrip", () => {
    const data = { "doc-1": [0.1, 0.2, 0.3], "doc-2": [0.4, 0.5, 0.6] }
    saveVectors(data)
    const loaded = loadVectors()
    expect(loaded).toEqual(data)
  })

  test("getAllEmbeddings filters docs with cached vectors", () => {
    const docs = [makeDoc({ id: "a" }), makeDoc({ id: "b" }), makeDoc({ id: "c" })]
    saveVectors({ a: [1, 2, 3], c: [4, 5, 6] })
    const result = getAllEmbeddings(docs)
    expect(result.length).toBe(2)
    expect(result.map(r => r.meta.id).sort()).toEqual(["a", "c"])
  })
})

describe("semanticSearch (unit, no model)", () => {
  test("returns empty for empty query", async () => {
    const docs = [{ meta: makeDoc(), embedding: [1, 2, 3] }]
    const result = await semanticSearch("", docs)
    expect(result).toEqual([])
  })

  test("returns empty for empty docs", async () => {
    const result = await semanticSearch("test", [])
    expect(result).toEqual([])
  })
})

describe("semanticSearch (integration, needs model)", () => {
  test("respects topK limit", async () => {
    if (!(await checkModel())) return
    const docs = Array.from({ length: 5 }, (_, i) => ({
      meta: makeDoc({ id: `doc-${i}`, title: `Doc ${i}` }),
      embedding: Array.from({ length: getEmbeddingDim() }, () => Math.random()),
    }))
    const result = await semanticSearch("test", docs, 3)
    expect(result.length).toBeLessThanOrEqual(3)
  }, 120000)

  test("results sorted by score descending", async () => {
    if (!(await checkModel())) return
    const docs = Array.from({ length: 5 }, (_, i) => ({
      meta: makeDoc({ id: `doc-${i}`, title: `Doc ${i}` }),
      embedding: Array.from({ length: getEmbeddingDim() }, () => Math.random()),
    }))
    const result = await semanticSearch("test", docs)
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score)
    }
  }, 120000)

  test("returns results for valid query", async () => {
    if (!(await checkModel())) return
    const docs = Array.from({ length: 3 }, (_, i) => ({
      meta: makeDoc({ id: `doc-${i}`, title: `Doc ${i}` }),
      embedding: Array.from({ length: getEmbeddingDim() }, () => Math.random()),
    }))
    const result = await semanticSearch("react hooks", docs)
    expect(result.length).toBeGreaterThan(0)
  }, 120000)
})

describe("indexDoc", () => {
  beforeEach(cleanDir)

  test("saves vector to store", async () => {
    if (!(await checkModel())) return
    const vec = await indexDoc("test-doc", "React hooks guide")
    expect(vec.length).toBe(getEmbeddingDim())
    const loaded = loadVectors()
    expect(loaded["test-doc"]).toEqual(vec)
  }, 120000)
})

describe("indexAllDocs", () => {
  beforeEach(cleanDir)

  test("indexes only missing docs", async () => {
    if (!(await checkModel())) return
    const docs = [
      makeDoc({ id: "cached", title: "Already cached" }),
      makeDoc({ id: "new1", title: "New doc one" }),
      makeDoc({ id: "new2", title: "New doc two" }),
    ]
    saveVectors({ cached: Array.from({ length: getEmbeddingDim() }, () => 0.5) })
    const count = await indexAllDocs(docs)
    expect(count).toBe(2)
    const loaded = loadVectors()
    expect(loaded.cached).toBeDefined()
    expect(loaded.new1).toBeDefined()
    expect(loaded.new2).toBeDefined()
  }, 120000)
})
