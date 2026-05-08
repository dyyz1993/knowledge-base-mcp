import { describe, test, expect, afterAll } from "bun:test"
import { existsSync, rmSync, readFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"

const tmpHome = join(os.tmpdir(), `kb-session-test-${Date.now()}`)
const origHome = process.env.HOME
process.env.HOME = tmpHome
mkdirSync(join(tmpHome, ".kb-chat", "sessions"), { recursive: true })

const store = await import("../src/chat/store-sessions")
const session = await import("../src/chat/session")

const { createSession, appendMessage, readMessages, readSession, deleteSession } = store
const { getOrCreate, pushMessage, getMessages } = session

const createdSessions: string[] = []

afterAll(() => {
  for (const id of createdSessions) {
    try { deleteSession(id) } catch {}
  }
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true })
  process.env.HOME = origHome
})

function track(id: string) {
  createdSessions.push(id)
  return id
}

describe("thinking message persistence", () => {
  test("push and read thinking message", () => {
    const sess = createSession()
    track(sess.id)
    const ts = Date.now()
    appendMessage(sess.id, { role: "thinking", content: "let me think about this", timestamp: ts })

    const msgs = readMessages(sess.id)
    const thinking = msgs.find(m => m.role === "thinking")
    expect(thinking).toBeDefined()
    expect(thinking!.content).toBe("let me think about this")
    expect(thinking!.timestamp).toBe(ts)
  })
})

describe("tool_call message persistence", () => {
  test("push and read tool_call message", () => {
    const sess = createSession()
    track(sess.id)
    const ts = Date.now()
    appendMessage(sess.id, {
      role: "tool_call",
      content: "kb_search({query: 'test'})",
      name: "kb_search",
      args: JSON.stringify({ query: "test" }),
      timestamp: ts,
      round: 0,
    })

    const msgs = readMessages(sess.id)
    const tc = msgs.find(m => m.role === "tool_call")
    expect(tc).toBeDefined()
    expect(tc!.name).toBe("kb_search")
    expect(tc!.args).toBe(JSON.stringify({ query: "test" }))
    expect(tc!.round).toBe(0)
  })
})

describe("tool_result message persistence", () => {
  test("push and read tool_result message", () => {
    const sess = createSession()
    track(sess.id)
    const ts = Date.now()
    appendMessage(sess.id, {
      role: "tool_result",
      content: '{"results":[]}',
      name: "kb_search",
      timestamp: ts,
      round: 0,
    })

    const msgs = readMessages(sess.id)
    const tr = msgs.find(m => m.role === "tool_result")
    expect(tr).toBeDefined()
    expect(tr!.name).toBe("kb_search")
    expect(tr!.content).toBe('{"results":[]}')
  })
})

describe("suggestions message persistence", () => {
  test("push and read suggestions message", () => {
    const sess = createSession()
    track(sess.id)
    const ts = Date.now()
    const suggestions = ["深入解释原理", "查看相关文档", "对比其他方案"]
    appendMessage(sess.id, {
      role: "suggestions",
      content: JSON.stringify(suggestions),
      timestamp: ts,
    })

    const msgs = readMessages(sess.id)
    const sug = msgs.find(m => m.role === "suggestions")
    expect(sug).toBeDefined()
    const parsed = JSON.parse(sug!.content)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(3)
    expect(parsed[0]).toBe("深入解释原理")
  })
})

describe("full conversation chain persistence", () => {
  test("user → thinking → tool_call → tool_result → suggestions → assistant", () => {
    const { session: sess, messages } = getOrCreate()
    track(sess.id)

    pushMessage(sess.id, { role: "user", content: "hello", timestamp: 1 })
    pushMessage(sess.id, { role: "thinking", content: "thinking...", timestamp: 2 })
    pushMessage(sess.id, {
      role: "tool_call",
      content: "kb_search({})",
      name: "kb_search",
      args: "{}",
      timestamp: 3,
      round: 0,
    })
    pushMessage(sess.id, {
      role: "tool_result",
      content: "[]",
      name: "kb_search",
      timestamp: 4,
      round: 0,
    })
    pushMessage(sess.id, {
      role: "suggestions",
      content: JSON.stringify(["s1", "s2"]),
      timestamp: 5,
    })
    pushMessage(sess.id, { role: "assistant", content: "answer", timestamp: 6 })

    const all = getMessages(sess.id)
    expect(all).toHaveLength(6)
    const roles = all.map(m => m.role)
    expect(roles).toEqual(["user", "thinking", "tool_call", "tool_result", "suggestions", "assistant"])

    expect(all[2].name).toBe("kb_search")
    expect(all[3].name).toBe("kb_search")
    expect(JSON.parse(all[4].content)).toEqual(["s1", "s2"])
  })
})

describe("session.jsonl file format", () => {
  test("first line is session metadata, subsequent lines are messages", () => {
    const sess = createSession()
    track(sess.id)
    appendMessage(sess.id, { role: "user", content: "hi", timestamp: Date.now() })

    const path = join(tmpHome, ".kb-chat", "sessions", `${sess.id}.jsonl`)
    expect(existsSync(path)).toBe(true)

    const lines = readFileSync(path, "utf-8").trim().split("\n")
    expect(lines.length).toBe(2)

    const header = JSON.parse(lines[0])
    expect(header.type).toBe("session")
    expect(header.id).toBe(sess.id)

    const msgLine = JSON.parse(lines[1])
    expect(msgLine.role).toBe("user")
    expect(msgLine.content).toBe("hi")
  })
})

describe("readMessages validates role types", () => {
  test("only returns messages with valid roles", () => {
    const sess = createSession()
    track(sess.id)
    const path = join(tmpHome, ".kb-chat", "sessions", `${sess.id}.jsonl`)

    const { appendFileSync } = require("node:fs")
    appendFileSync(path, JSON.stringify({ role: "user", content: "hi", timestamp: 1 }) + "\n")
    appendFileSync(path, JSON.stringify({ role: "invalid_role", content: "x", timestamp: 2 }) + "\n")
    appendFileSync(path, JSON.stringify({ role: "thinking", content: "hmm", timestamp: 3 }) + "\n")

    const msgs = readMessages(sess.id)
    expect(msgs).toHaveLength(2)
    expect(msgs.map(m => m.role)).toEqual(["user", "thinking"])
  })

  test("all six role types are accepted", () => {
    const roles = ["user", "assistant", "thinking", "tool_call", "tool_result", "suggestions"] as const
    const sess = createSession()
    track(sess.id)

    roles.forEach((role, i) => {
      appendMessage(sess.id, { role, content: `msg-${i}`, timestamp: i, ...(role === "tool_call" || role === "tool_result" ? { name: "f" } : {}) })
    })

    const msgs = readMessages(sess.id)
    expect(msgs).toHaveLength(6)
    expect(msgs.map(m => m.role)).toEqual([...roles])
  })
})
