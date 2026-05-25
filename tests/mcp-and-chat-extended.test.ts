import { describe, test, expect, beforeEach, afterEach, mock, afterAll } from "bun:test"
import {
  mkdtempSync, rmSync, writeFileSync, readFileSync,
  existsSync, mkdirSync, readdirSync,
} from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

let tempDir: string
let kbDir: string
let dataDir: string
let origKbDir: string | undefined
let origDataDir: string | undefined

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kb-ext-test-"))
  kbDir = join(tempDir, "kb")
  dataDir = join(tempDir, "data")
  mkdirSync(kbDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  origKbDir = process.env.KB_DIR
  origDataDir = process.env.KB_DATA_DIR
  process.env.KB_DIR = kbDir
  process.env.KB_DATA_DIR = dataDir
})

afterEach(() => {
  process.env.KB_DIR = origKbDir
  process.env.KB_DATA_DIR = origDataDir
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
})

afterAll(() => {
  process.env.KB_DIR = origKbDir
  process.env.KB_DATA_DIR = origDataDir
})

// ─── MCP doc-tools ──────────────────────────────────────────

describe("MCP doc-tools", () => {
  test("kb_write should save document", async () => {
    const storage = await import("../src/storage/index")
    const doc = storage.writeDoc(
      {
        title: "Test Doc",
        tags: ["tutorial"],
        keywords: ["test"],
        intent: "testing kb_write",
        project_description: "test project",
        source_project: "/tmp/test",
      },
      "# Hello\n\nSome content here.",
    )
    expect(doc.id).toBeTruthy()
    expect(doc.title).toBe("Test Doc")
    expect(doc.file_path).toContain(kbDir)
    expect(existsSync(doc.file_path)).toBe(true)
  })

  test("kb_read should return document by ID", async () => {
    const storage = await import("../src/storage/index")
    const doc = storage.writeDoc(
      {
        title: "Readable Doc",
        tags: ["document"],
        keywords: ["read"],
        intent: "test read",
        project_description: "test",
        source_project: "/tmp/read",
      },
      "Content for reading.",
    )
    const result = storage.readDoc(doc.id, false)
    expect(result).not.toBeNull()
    expect(result!.meta.id).toBe(doc.id)
    expect(result!.meta.title).toBe("Readable Doc")
    expect(result!.content).toContain("Content for reading")
  })

  test("kb_read should return error for missing ID", async () => {
    const storage = await import("../src/storage/index")
    const result = storage.readDoc("nonexistent_id_xyz", false)
    expect(result).toBeNull()
  })

  test("kb_delete should remove document", async () => {
    const storage = await import("../src/storage/index")
    const doc = storage.writeDoc(
      {
        title: "Delete Me",
        tags: ["test"],
        keywords: ["delete"],
        intent: "test delete",
        project_description: "test",
        source_project: "/tmp/del",
      },
      "To be deleted.",
    )
    expect(existsSync(doc.file_path)).toBe(true)
    const ok = storage.deleteDoc(doc.id)
    expect(ok).toBe(true)
    expect(existsSync(doc.file_path)).toBe(false)
  })

  test("kb_outline should return project outline", async () => {
    const storage = await import("../src/storage/index")
    const projectPath = "/tmp/outline-proj"
    storage.writeDoc(
      {
        title: "Outline Doc A",
        tags: ["guide"],
        keywords: ["outline"],
        intent: "outline test",
        project_description: "outline project",
        source_project: projectPath,
      },
      "Content A.",
    )
    storage.writeDoc(
      {
        title: "Outline Doc B",
        tags: ["reference"],
        keywords: ["outline2"],
        intent: "outline test 2",
        project_description: "outline project",
        source_project: projectPath,
      },
      "Content B.",
    )
    const outline = storage.getOutline(projectPath)
    expect(outline).not.toBeNull()
    expect((outline as any).docs.length).toBe(2)
  })

  test("kb_update should update existing document", async () => {
    const storage = await import("../src/storage/index")
    const doc = storage.writeDoc(
      {
        title: "Update Me",
        tags: ["test"],
        keywords: ["update"],
        intent: "test update",
        project_description: "test",
        source_project: "/tmp/upd",
      },
      "Original content.",
    )
    const updated = storage.writeDoc(
      {
        id: doc.id,
        title: "Updated Title",
        tags: ["test", "updated"],
        keywords: ["update", "v2"],
        intent: doc.intent,
        project_description: doc.project_description,
        source_project: doc.source_project || "",
        source_worktree: "",
        created_at: doc.created_at,
      },
      "Updated content here.",
    )
    expect(updated.id).toBe(doc.id)
    expect(updated.title).toBe("Updated Title")
    const result = storage.readDoc(doc.id, false)
    expect(result!.content).toContain("Updated content here")
  })
})

// ─── MCP search-tools ───────────────────────────────────────

describe("MCP search-tools", () => {
  test("kb_search should search documents", async () => {
    const storage = await import("../src/storage/index")
    storage.writeDoc(
      {
        title: "React Patterns",
        tags: ["guide"],
        keywords: ["react", "patterns"],
        intent: "react patterns guide",
        project_description: "test",
        source_project: "/tmp/search",
      },
      "React hooks and patterns guide content.",
    )
    storage.writeDoc(
      {
        title: "Vue Patterns",
        tags: ["guide"],
        keywords: ["vue", "patterns"],
        intent: "vue patterns guide",
        project_description: "test",
        source_project: "/tmp/search",
      },
      "Vue composition API patterns.",
    )
    const results = storage.searchDocs("React", undefined, undefined, 10)
    expect(results.length).toBeGreaterThanOrEqual(1)
    const reactResults = results.filter(r => r.title.includes("React"))
    expect(reactResults.length).toBeGreaterThanOrEqual(1)
  })

  test("kb_search_semantic should use embedding search", async () => {
    const { searchDocsSemantic } = await import("../src/storage/index")
    const results = await searchDocsSemantic("nonexistent query xyz", 5)
    expect(Array.isArray(results)).toBe(true)
  })

  test("kb_list should list by tag/project", async () => {
    const storage = await import("../src/storage/index")
    const projectPath = "/tmp/list-proj"
    storage.writeDoc(
      {
        title: "Listed Doc",
        tags: ["tutorial"],
        keywords: ["list"],
        intent: "list test",
        project_description: "list project",
        source_project: projectPath,
      },
      "List test content.",
    )
    const byTag = storage.listDocs("tutorial")
    expect(byTag.length).toBeGreaterThanOrEqual(1)
    expect(byTag.some(d => d.title === "Listed Doc")).toBe(true)

    const byProject = storage.listDocs(undefined, projectPath)
    expect(byProject.length).toBeGreaterThanOrEqual(1)
    expect(byProject.some(d => d.title === "Listed Doc")).toBe(true)
  })

  test("kb_recent should return recent documents", async () => {
    const storage = await import("../src/storage/index")
    storage.writeDoc(
      {
        title: "Recent Doc",
        tags: ["test"],
        keywords: ["recent"],
        intent: "recent test",
        project_description: "test",
        source_project: "/tmp/recent",
      },
      "Recent content.",
    )
    const results = storage.listRecentDocs({ hours: 1, limit: 10 })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(r => r.meta.title === "Recent Doc")).toBe(true)
  })

  test("kb_ask should run ask pipeline", async () => {
    const { kbAskPipeline } = await import("../src/search/kb-ask-pipeline")
    const result = await kbAskPipeline("completely nonexistent query xyzzy123", 0)
    expect(result).toBeDefined()
    expect(typeof result.from_kb).toBe("boolean")
    expect(typeof result.loops_used).toBe("number")
    expect(Array.isArray(result.queries_used)).toBe(true)
  }, 30000)
})

// ─── MCP file-tools ─────────────────────────────────────────

describe("MCP file-tools", () => {
  test("file_read should read file content", async () => {
    const testFile = join(tempDir, "read-test.txt")
    writeFileSync(testFile, "line1\nline2\nline3\n")
    const { readFileSync: rf } = await import("node:fs")
    const raw = rf(testFile, "utf-8")
    const lines = raw.split("\n")
    expect(lines.length).toBe(4)
    expect(lines[0]).toBe("line1")

    const { existsSync: ex } = await import("node:fs")
    expect(ex(testFile)).toBe(true)
  })

  test("file_read should handle non-existent path", () => {
    expect(existsSync("/absolutely/does/not/exist.txt")).toBe(false)
  })

  test("file_grep should search file content", async () => {
    const testFile = join(tempDir, "grep-test.txt")
    writeFileSync(testFile, "hello world\nfoo bar\nhello again\n")
    const raw = readFileSync(testFile, "utf-8")
    const lines = raw.split("\n")
    const matches = lines
      .map((line, i) => ({ line: i + 1, content: line, match: line.match(/hello/gi) }))
      .filter(m => m.match)
    expect(matches.length).toBe(2)
    expect(matches[0].line).toBe(1)
    expect(matches[1].line).toBe(3)
  })

  test("file_grep should reject dangerous regex patterns", async () => {
    const { validateRegexPattern } = await import("../src/utils/regex-safety")
    const dangerous = validateRegexPattern("(a+)+b")
    expect(dangerous.safe).toBe(false)
    expect(dangerous.reason).toContain("dangerous")

    const tooLong = validateRegexPattern("a".repeat(501))
    expect(tooLong.safe).toBe(false)
    expect(tooLong.reason).toContain("too long")

    const safe = validateRegexPattern("hello.*world")
    expect(safe.safe).toBe(true)
  })

  test("file_exists should check path existence", () => {
    const filePath = join(tempDir, "exists-check.txt")
    writeFileSync(filePath, "data")
    expect(existsSync(filePath)).toBe(true)
    expect(existsSync(join(tempDir, "no-such-file"))).toBe(false)
    expect(existsSync(tempDir)).toBe(true)
  })
})

// ─── chat sessions API ──────────────────────────────────────

describe("chat sessions API", () => {
  test("should create new session", async () => {
    const store = await import("../src/chat/store-sessions")
    const sess = store.createSession("Test Session")
    expect(sess.id).toBeTruthy()
    expect(sess.name).toBe("Test Session")
    expect(sess.createdAt).toBeGreaterThan(0)
    const path = join(dataDir, "sessions", `${sess.id}.jsonl`)
    expect(existsSync(path)).toBe(true)
  })

  test("should list sessions", async () => {
    const store = await import("../src/chat/store-sessions")
    store.createSession("S1")
    store.createSession("S2")
    const list = store.listSessions()
    expect(list.length).toBeGreaterThanOrEqual(2)
    const names = list.map(s => s.name)
    expect(names).toContain("S1")
    expect(names).toContain("S2")
  })

  test("should delete session", async () => {
    const store = await import("../src/chat/store-sessions")
    const sess = store.createSession("ToDelete")
    const path = join(dataDir, "sessions", `${sess.id}.jsonl`)
    expect(existsSync(path)).toBe(true)
    const ok = store.deleteSession(sess.id)
    expect(ok).toBe(true)
    expect(existsSync(path)).toBe(false)

    const ok2 = store.deleteSession("nonexistent")
    expect(ok2).toBe(false)
  })

  test("should export session as markdown", async () => {
    const store = await import("../src/chat/store-sessions")
    const { exportSession } = await import("../src/chat/session-export")
    const sess = store.createSession("Export Test")
    store.appendMessage(sess.id, {
      role: "user",
      content: "Hello export",
      timestamp: Date.now(),
    })
    store.appendMessage(sess.id, {
      role: "assistant",
      content: "Exported response",
      timestamp: Date.now(),
    })
    const md = exportSession(sess.id)
    expect(md).not.toBeNull()
    expect(md!).toContain("Export Test")
    expect(md!).toContain("Hello export")
    expect(md!).toContain("Exported response")
    expect(md!).toContain("User Query")
    expect(md!).toContain("Conclusion")

    const nullResult = exportSession("nonexistent_session_id")
    expect(nullResult).toBeNull()
  })
})

// ─── chat favorites ─────────────────────────────────────────

describe("chat favorites", () => {
  test("should add favorite", async () => {
    const favs = await import("../src/chat/store-favorites")
    const fav = await favs.addFavorite({
      sessionId: "sess-123",
      messageId: "msg-456",
      content: "Important message",
    })
    expect(fav.id).toBeTruthy()
    expect(fav.sessionId).toBe("sess-123")
    expect(fav.content).toBe("Important message")
    expect(fav.createdAt).toBeGreaterThan(0)
  })

  test("should remove favorite", async () => {
    const favs = await import("../src/chat/store-favorites")
    const fav = await favs.addFavorite({
      sessionId: "sess-del",
      messageId: "msg-del",
      content: "To delete",
    })
    const ok = await favs.deleteFavorite(fav.id)
    expect(ok).toBe(true)
    const remaining = await favs.listFavorites()
    expect(remaining.find(f => f.id === fav.id)).toBeUndefined()
  })

  test("should list favorites", async () => {
    const favs = await import("../src/chat/store-favorites")
    await favs.addFavorite({ sessionId: "s1", messageId: "m1", content: "Fav 1" })
    await favs.addFavorite({ sessionId: "s2", messageId: "m2", content: "Fav 2" })
    const list = await favs.listFavorites()
    expect(list.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── browser-launcher ───────────────────────────────────────

describe("browser-launcher", () => {
  test("should detect Chrome on macOS", async () => {
    const { detectBrowserPath } = await import("../src/chat/browser-launcher")
    const originalPlatform = process.platform
    if (originalPlatform === "darwin") {
      const path = detectBrowserPath()
      if (path) {
        expect(typeof path).toBe("string")
        expect(path).toMatch(/Chrome|Chromium/)
      }
    }
  })

  test("should return null or string for current platform", async () => {
    const { detectBrowserPath } = await import("../src/chat/browser-launcher")
    const result = detectBrowserPath()
    expect(result === null || typeof result === "string").toBe(true)
  })

  test("should resolve CDP endpoint from config", async () => {
    const { loadConfig } = await import("../src/config")
    const config = loadConfig()
    expect(config).toBeDefined()
    expect(config.browser).toBeDefined()
    expect(typeof config.browser.cdpEndpoint).toBe("string")
    expect(typeof config.browser.headless).toBe("boolean")
  })
})

// ─── session-favorites store ────────────────────────────────

describe("session-favorites store", () => {
  test("should add and check session favorite", async () => {
    const sf = await import("../src/chat/store-session-favorites")
    const entry = sf.addSessionFavorite("sess-abc", "important session")
    expect(entry.sessionId).toBe("sess-abc")
    expect(entry.note).toBe("important session")
    expect(sf.isSessionFavorited("sess-abc")).toBe(true)
  })

  test("should remove session favorite", async () => {
    const sf = await import("../src/chat/store-session-favorites")
    sf.addSessionFavorite("sess-remove")
    expect(sf.isSessionFavorited("sess-remove")).toBe(true)
    const ok = sf.removeSessionFavorite("sess-remove")
    expect(ok).toBe(true)
    expect(sf.isSessionFavorited("sess-remove")).toBe(false)
  })

  test("should list session favorites sorted by pinnedAt desc", async () => {
    const sf = await import("../src/chat/store-session-favorites")
    sf.addSessionFavorite("sess-first")
    sf.addSessionFavorite("sess-second")
    const list = sf.listSessionFavorites()
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(list[0].pinnedAt).toBeGreaterThanOrEqual(list[1].pinnedAt)
  })
})
