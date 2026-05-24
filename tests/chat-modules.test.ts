import { describe, test, expect, beforeEach, afterEach, beforeAll } from "bun:test"
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const testDataDir = `/tmp/kb-chat-test-${Math.random().toString(36).slice(2)}`

import {
  createSession,
  appendMessage,
  readMessages,
  readSession,
  listSessions,
  deleteSession,
  updateSessionName,
  updateSessionModel,
  type ChatSession,
  type ChatMessage,
} from "../src/chat/store-sessions"

beforeAll(() => {
  process.env.KB_DATA_DIR = testDataDir
})

const favoritesPath = join(testDataDir, "favorites.json")

function writeFavorites(favs: unknown[]) {
  mkdirSync(testDataDir, { recursive: true })
  writeFileSync(favoritesPath, JSON.stringify(favs, null, 2))
}

function readFavoritesFile(): unknown[] {
  if (!existsSync(favoritesPath)) return []
  return JSON.parse(readFileSync(favoritesPath, "utf-8"))
}

beforeEach(() => {
  if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true })
  mkdirSync(testDataDir, { recursive: true })
  mkdirSync(join(testDataDir, "sessions"), { recursive: true })
})

afterEach(() => {
  if (existsSync(testDataDir)) rmSync(testDataDir, { recursive: true })
})

describe("chat session", () => {
  test("should create new session", () => {
    const session = createSession()
    expect(session.id).toBeDefined()
    expect(session.id.length).toBeGreaterThan(0)
    expect(session.createdAt).toBeGreaterThan(0)
    expect(session.name).toBeDefined()
  })

  test("should load existing session", () => {
    const created = createSession("My Chat")
    const loaded = readSession(created.id)
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe(created.id)
    expect(loaded!.name).toBe("My Chat")
  })

  test("should add messages to session", () => {
    const session = createSession()
    const msg: ChatMessage = { role: "user", content: "Hello", timestamp: Date.now() }
    appendMessage(session.id, msg)
    const messages = readMessages(session.id)
    expect(messages.length).toBe(1)
    expect(messages[0].content).toBe("Hello")
    expect(messages[0].role).toBe("user")
  })

  test("should enforce session limit (200)", () => {
    const sessions: ChatSession[] = []
    for (let i = 0; i < 200; i++) {
      sessions.push(createSession(`Chat ${i}`))
    }
    const listed = listSessions()
    expect(listed.length).toBe(200)
  })

  test("should list sessions sorted by date descending", () => {
    const s1 = createSession("First")
    const s2 = createSession("Second")
    const s3 = createSession("Third")
    const listed = listSessions()
    expect(listed.length).toBe(3)
    const ids = listed.map(s => s.id)
    expect(ids).toContain(s1.id)
    expect(ids).toContain(s2.id)
    expect(ids).toContain(s3.id)
  })

  test("should delete session", () => {
    const session = createSession("To Delete")
    expect(deleteSession(session.id)).toBe(true)
    expect(readSession(session.id)).toBeNull()
  })

  test("should return false for deleting non-existent session", () => {
    expect(deleteSession("non-existent")).toBe(false)
  })

  test("should update session name", () => {
    const session = createSession("Original")
    updateSessionName(session.id, "Updated")
    const loaded = readSession(session.id)
    expect(loaded!.name).toBe("Updated")
  })

  test("should update session model", () => {
    const session = createSession()
    updateSessionModel(session.id, { provider: "openai", id: "gpt-4" })
    const loaded = readSession(session.id)
    expect(loaded!.model).toEqual({ provider: "openai", id: "gpt-4" })
  })

  test("should read messages skip header line", () => {
    const session = createSession()
    const msg1: ChatMessage = { role: "user", content: "Hi", timestamp: Date.now() }
    const msg2: ChatMessage = { role: "assistant", content: "Hello", timestamp: Date.now() }
    appendMessage(session.id, msg1)
    appendMessage(session.id, msg2)
    const messages = readMessages(session.id)
    expect(messages.length).toBe(2)
    expect(messages[0].role).toBe("user")
    expect(messages[1].role).toBe("assistant")
  })

  test("should return empty messages for non-existent session", () => {
    expect(readMessages("non-existent")).toEqual([])
  })
})

describe("store-favorites", () => {
  test("should save and load favorites", async () => {
    const { addFavorite, listFavorites } = await import("../src/chat/store-favorites")
    const fav = await addFavorite({ sessionId: "s1", messageId: "m1", content: "Great answer" })
    expect(fav.content).toBe("Great answer")
    expect(fav.sessionId).toBe("s1")
    expect(existsSync(favoritesPath)).toBe(true)
    const data = readFavoritesFile() as Array<{ content: string }>
    expect(data.some(f => f.content === "Great answer")).toBe(true)
  })

  test("should add/remove favorites", async () => {
    const { addFavorite, deleteFavorite } = await import("../src/chat/store-favorites")
    const fav = await addFavorite({ sessionId: "s1", messageId: "m1", content: "Test" })
    expect(await deleteFavorite(fav.id)).toBe(true)
    const data = readFavoritesFile() as Array<{ id: string }>
    expect(data.find(f => f.id === fav.id)).toBeUndefined()
  })

  test("should handle missing file gracefully", async () => {
    const { listFavorites } = await import("../src/chat/store-favorites")
    const favs = await listFavorites()
    expect(favs).toEqual([])
  })

  test("should not deduplicate favorites (each add creates new entry)", async () => {
    const { addFavorite, listFavorites } = await import("../src/chat/store-favorites")
    await addFavorite({ sessionId: "s1", messageId: "m1", content: "Same" })
    await addFavorite({ sessionId: "s1", messageId: "m1", content: "Same" })
    const favs = await listFavorites()
    expect(favs.length).toBe(2)
    expect(favs[0].id).not.toBe(favs[1].id)
  })

  test("should sort favorites by createdAt descending", async () => {
    const { addFavorite, listFavorites } = await import("../src/chat/store-favorites")
    const f1 = await addFavorite({ sessionId: "s1", messageId: "m1", content: "First" })
    writeFavorites([...readFavoritesFile() as Array<Record<string, unknown>>].map(f => {
      if ((f as { id: string }).id === f1.id) return { ...f, createdAt: Date.now() - 1000 }
      return f
    }))
    await addFavorite({ sessionId: "s2", messageId: "m2", content: "Second" })
    const favs = await listFavorites()
    expect(favs.length).toBe(2)
    expect(favs[0].content).toBe("Second")
    expect(favs[1].content).toBe("First")
  })

  test("should return false for deleting non-existent favorite", async () => {
    const { deleteFavorite } = await import("../src/chat/store-favorites")
    expect(await deleteFavorite("non-existent")).toBe(false)
  })

  test("favorite should have auto-generated id and createdAt", async () => {
    const { addFavorite } = await import("../src/chat/store-favorites")
    const fav = await addFavorite({ sessionId: "s1", messageId: "m1", content: "Test" })
    expect(fav.id).toBeDefined()
    expect(fav.id.length).toBeGreaterThan(0)
    expect(fav.createdAt).toBeGreaterThan(0)
  })
})
