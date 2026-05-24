import { test, expect, describe, beforeEach, afterEach, beforeAll, afterAll } from "bun:test"
import { join } from "node:path"
import { existsSync, mkdirSync, rmSync } from "node:fs"

const ORIGINAL_HOME = process.env.HOME
const TEST_DIR = join(process.env.HOME || "/tmp", ".kb-chat-test-session")

const { getOrCreate, pushMessage, getMessages, setName, setModel, list } = await import("../src/chat/session")

beforeAll(() => {
  process.env.HOME = TEST_DIR
})

afterAll(() => {
  process.env.HOME = ORIGINAL_HOME
})

describe("session management", () => {
  const sessionsDir = join(TEST_DIR, ".kb-chat", "sessions")

  beforeEach(() => {
    if (existsSync(sessionsDir)) rmSync(sessionsDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(sessionsDir)) rmSync(sessionsDir, { recursive: true })
  })

  afterEach(() => {
    process.env.HOME = ORIGINAL_HOME
  })

  describe("getOrCreate", () => {
    test("should create new session when no sessionId provided", () => {
      const { session, messages } = getOrCreate()

      expect(session.id).toBeTruthy()
      expect(session.name).toContain("Chat")
      expect(session.createdAt).toBeGreaterThan(0)
      expect(messages).toEqual([])
    })

    test("should return new session when sessionId does not exist", () => {
      const { session, messages } = getOrCreate("nonexistent-id")

      expect(session.id).toBeTruthy()
      expect(messages).toEqual([])
    })

    test("should create session with unique IDs", () => {
      const a = getOrCreate()
      const b = getOrCreate()

      expect(a.session.id).not.toBe(b.session.id)
    })
  })

  describe("pushMessage and getMessages", () => {
    test("should push and retrieve messages", () => {
      const { session } = getOrCreate()
      const msg = { role: "user" as const, content: "Hello", timestamp: Date.now() }

      pushMessage(session.id, msg)
      const messages = getMessages(session.id)

      expect(messages).toHaveLength(1)
      expect(messages[0].content).toBe("Hello")
      expect(messages[0].role).toBe("user")
    })

    test("should push multiple messages in order", () => {
      const { session } = getOrCreate()

      pushMessage(session.id, { role: "user", content: "first", timestamp: Date.now() })
      pushMessage(session.id, { role: "assistant", content: "second", timestamp: Date.now() })

      const messages = getMessages(session.id)
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe("first")
      expect(messages[1].content).toBe("second")
    })

    test("should return messages from cache on repeated calls", () => {
      const { session } = getOrCreate()
      pushMessage(session.id, { role: "user", content: "cached", timestamp: Date.now() })

      const first = getMessages(session.id)
      const second = getMessages(session.id)

      expect(first).toBe(second)
    })
  })

  describe("setName", () => {
    test("should update session name", () => {
      const { session } = getOrCreate()
      setName(session.id, "My Chat")

      const retrieved = getOrCreate(session.id)
      expect(retrieved.session.name).toBe("My Chat")
    })
  })

  describe("setModel", () => {
    test("should update session model", () => {
      const { session } = getOrCreate()
      setModel(session.id, { provider: "openai", id: "gpt-4" })

      const retrieved = getOrCreate(session.id)
      expect(retrieved.session.model).toEqual({ provider: "openai", id: "gpt-4" })
    })
  })

  describe("list", () => {
    test("should list created sessions", () => {
      getOrCreate()
      getOrCreate()

      const sessions = list()
      expect(sessions.length).toBeGreaterThanOrEqual(2)
    })
  })
})
