import { describe, test, expect } from "bun:test"
import {
  tokenize,
  buildTF,
  buildIDF,
  cosineSimilarity,
  tfidfSearch,
} from "../src/search/tfidf"
import type { DocMeta } from "../src/storage/index"

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

describe("tokenize", () => {
  test("splits English words", () => {
    const t = tokenize("Hello World Foo")
    expect(t).toContain("hello")
    expect(t).toContain("world")
    expect(t).toContain("foo")
  })

  test("lowercases tokens", () => {
    expect(tokenize("HELLO")).toContain("hello")
  })

  test("removes punctuation", () => {
    const t = tokenize("hello, world! foo-bar")
    expect(t).toContain("hello")
    expect(t).toContain("world")
    expect(t).toContain("foo")
    expect(t).toContain("bar")
  })

  test("Chinese bigrams", () => {
    const t = tokenize("插件开发")
    expect(t).toContain("插件")
    expect(t).toContain("件开")
    expect(t).toContain("开发")
  })

  test("mixed Chinese and English", () => {
    const t = tokenize("React 插件开发 guide")
    expect(t).toContain("react")
    expect(t).toContain("插件")
    expect(t).toContain("开发")
    expect(t).toContain("guide")
  })

  test("empty string returns empty array", () => {
    expect(tokenize("")).toEqual([])
  })

  test("single Chinese char produces no bigrams", () => {
    expect(tokenize("你")).toEqual([])
  })

  test("numbers are tokens", () => {
    const t = tokenize("test 42 thing")
    expect(t).toContain("test")
    expect(t).toContain("42")
    expect(t).toContain("thing")
  })
})

describe("buildTF", () => {
  test("counts term frequencies", () => {
    const tf = buildTF(["hello", "world", "hello"])
    expect(tf.get("hello")).toBe(2)
    expect(tf.get("world")).toBe(1)
  })

  test("empty input returns empty map", () => {
    expect(buildTF([]).size).toBe(0)
  })

  test("single token", () => {
    const tf = buildTF(["solo"])
    expect(tf.get("solo")).toBe(1)
    expect(tf.size).toBe(1)
  })
})

describe("buildIDF", () => {
  test("rare terms get higher IDF than common terms", () => {
    const docs = [
      makeDoc({ title: "alpha x", keywords: [], intent: "", project_description: "" }),
      makeDoc({ title: "beta", keywords: [], intent: "", project_description: "" }),
      makeDoc({ title: "alpha gamma", keywords: [], intent: "", project_description: "" }),
    ]
    const idf = buildIDF(docs)
    expect(idf.get("beta")!).toBeGreaterThan(idf.get("alpha")!)
  })

  test("term in single doc gets highest IDF", () => {
    const docs = [
      makeDoc({ title: "common rare", keywords: [], intent: "", project_description: "" }),
      makeDoc({ title: "common", keywords: [], intent: "", project_description: "" }),
    ]
    const idf = buildIDF(docs)
    expect(idf.get("rare")!).toBeGreaterThan(idf.get("common")!)
  })
})

describe("cosineSimilarity", () => {
  test("identical vectors = 1.0", () => {
    const v = new Map([
      ["a", 1],
      ["b", 2],
    ])
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  test("orthogonal vectors = 0.0", () => {
    const a = new Map([["x", 1]])
    const b = new Map([["y", 1]])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  test("similar vectors have high similarity", () => {
    const a = new Map([
      ["react", 3],
      ["hooks", 2],
      ["state", 1],
    ])
    const b = new Map([
      ["react", 3],
      ["hooks", 2],
      ["component", 1],
    ])
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.8)
  })

  test("empty vectors return 0", () => {
    expect(cosineSimilarity(new Map(), new Map())).toBe(0)
  })

  test("one empty one non-empty returns 0", () => {
    const a = new Map([["x", 1]])
    expect(cosineSimilarity(a, new Map())).toBe(0)
  })
})

describe("tfidfSearch", () => {
  const docs = [
    makeDoc({
      id: "react-hooks",
      title: "React Hooks Best Practices",
      keywords: ["react", "hooks", "useState"],
      intent: "Guide for React hooks usage",
      project_description: "React development patterns",
    }),
    makeDoc({
      id: "plugin-dev",
      title: "Plugin Development Guide",
      keywords: ["plugin", "extension", "opencode"],
      intent: "How to develop plugins",
      project_description: "Plugin architecture",
    }),
    makeDoc({
      id: "rpc-arch",
      title: "RPC Protocol Architecture",
      keywords: ["rpc", "protocol", "grpc"],
      intent: "RPC protocol design patterns",
      project_description: "Service communication",
    }),
  ]

  test("search 'react hooks' finds React doc first", () => {
    const idf = buildIDF(docs)
    const results = tfidfSearch("react hooks", docs, idf)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe("react-hooks")
  })

  test("search 'plugin' finds plugin doc first", () => {
    const idf = buildIDF(docs)
    const results = tfidfSearch("plugin", docs, idf)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe("plugin-dev")
  })

  test("search 'rpc protocol' finds rpc doc first", () => {
    const idf = buildIDF(docs)
    const results = tfidfSearch("rpc protocol", docs, idf)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe("rpc-arch")
  })

  test("Chinese search finds Chinese content", () => {
    const chineseDocs = [
      makeDoc({
        id: "cn-plugin",
        title: "插件开发指南",
        keywords: ["插件", "开发"],
        intent: "插件开发教程",
        project_description: "插件架构",
      }),
      makeDoc({
        id: "cn-react",
        title: "React 教程",
        keywords: ["react"],
        intent: "React 学习",
        project_description: "前端开发",
      }),
    ]
    const idf = buildIDF(chineseDocs)
    const results = tfidfSearch("插件开发", chineseDocs, idf)
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].id).toBe("cn-plugin")
  })

  test("empty query returns empty results", () => {
    const idf = buildIDF(docs)
    expect(tfidfSearch("", docs, idf)).toEqual([])
  })

  test("whitespace-only query returns empty results", () => {
    const idf = buildIDF(docs)
    expect(tfidfSearch("   ", docs, idf)).toEqual([])
  })

  test("no matching docs returns empty results", () => {
    const idf = buildIDF(docs)
    const results = tfidfSearch("zzzznonexistent", docs, idf)
    expect(results.length).toBe(0)
  })

  test("results sorted by score descending", () => {
    const idf = buildIDF(docs)
    const results = tfidfSearch("react hooks plugin", docs, idf)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
    }
  })

  test("respects topK limit", () => {
    const idf = buildIDF(docs)
    const results = tfidfSearch("react", docs, idf, 1)
    expect(results.length).toBeLessThanOrEqual(1)
  })

  test("all scores are positive", () => {
    const idf = buildIDF(docs)
    const results = tfidfSearch("react", docs, idf)
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0)
    }
  })

  test("empty docs array returns empty", () => {
    expect(tfidfSearch("test", [], new Map())).toEqual([])
  })
})
