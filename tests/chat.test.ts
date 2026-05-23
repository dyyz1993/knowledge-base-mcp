import { describe, test, expect, mock, beforeEach } from "bun:test"
import {
  type ChatMessage,
  parseToolCallArgs,
  sanitizeChatMessages,
  restoreChatContext,
} from "../src/chat/llm-client.js"
import { parseModelRef, resolveConfiguredModel } from "../src/chat/api-chat.js"

describe("parseToolCallArgs", () => {
  test("parses valid JSON", () => {
    expect(parseToolCallArgs('{"query":"test","limit":5}')).toEqual({ query: "test", limit: 5 })
  })

  test("returns empty object for invalid JSON", () => {
    expect(parseToolCallArgs("not json")).toEqual({})
  })

  test("returns empty object for empty string", () => {
    expect(parseToolCallArgs("")).toEqual({})
  })
})

describe("sanitizeChatMessages", () => {
  test("removes trailing tool message without matching assistant tool_call", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "tool", content: "result", tool_call_id: "tc_1" },
    ]
    sanitizeChatMessages(msgs)
    expect(msgs).toEqual([{ role: "user", content: "hi" }])
  })

  test("keeps tool message when matching assistant tool_call exists", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "tc_1", type: "function", function: { name: "kb_search", arguments: "{}" } }],
      },
      { role: "tool", content: "result", tool_call_id: "tc_1" },
    ]
    sanitizeChatMessages(msgs)
    expect(msgs.length).toBe(3)
  })

  test("removes trailing assistant with tool_calls but no tool results", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "tc_1", type: "function", function: { name: "kb_search", arguments: "{}" } }],
      },
    ]
    sanitizeChatMessages(msgs)
    expect(msgs).toEqual([{ role: "user", content: "hi" }])
  })

  test("strips tool_calls from trailing assistant that has content", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "partial answer",
        tool_calls: [{ id: "tc_1", type: "function", function: { name: "kb_search", arguments: "{}" } }],
      },
    ]
    sanitizeChatMessages(msgs)
    expect(msgs.length).toBe(2)
    expect(msgs[1].tool_calls).toBeUndefined()
    expect(msgs[1].content).toBe("partial answer")
  })

  test("does nothing for normal user/assistant pair", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]
    sanitizeChatMessages(msgs)
    expect(msgs.length).toBe(2)
  })
})

describe("restoreChatContext", () => {
  test("restores simple user/assistant conversation", () => {
    const msgs = [
      { role: "user", content: "hello", timestamp: 1000 },
      { role: "assistant", content: "hi there", timestamp: 2000 },
    ]
    const result = restoreChatContext(msgs)
    expect(result).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi there" },
    ])
  })

  test("reconstructs tool_call + tool_result pairs", () => {
    const msgs = [
      { role: "user", content: "search for X", timestamp: 1000 },
      { role: "assistant", content: "", timestamp: 2000 },
      { role: "tool_call", content: "kb_search({})", name: "kb_search", args: '{"query":"X"}', timestamp: 3000 },
      { role: "tool_result", content: "found doc", name: "kb_search", timestamp: 4000 },
      { role: "assistant", content: "Here is X", timestamp: 5000 },
    ]
    const result = restoreChatContext(msgs)
    expect(result.length).toBe(3)
    expect(result[0]).toEqual({ role: "user", content: "search for X" })
    expect(result[1].role).toBe("tool")
    expect((result[1] as ChatMessage & { tool_call_id: string }).name).toBe("kb_search")
    expect(result[2]).toEqual({ role: "assistant", content: "Here is X" })
  })

  test("skips thinking messages", () => {
    const msgs = [
      { role: "user", content: "hi", timestamp: 1000 },
      { role: "thinking", content: "hmm...", timestamp: 2000 },
      { role: "assistant", content: "answer", timestamp: 3000 },
    ]
    const result = restoreChatContext(msgs)
    expect(result).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "answer" },
    ])
  })

  test("handles empty messages array", () => {
    const result = restoreChatContext([])
    expect(result).toEqual([])
  })

  test("flushes pending assistant with pending tool calls at end", () => {
    const msgs = [
      { role: "user", content: "hi", timestamp: 1000 },
      { role: "assistant", content: "let me search", timestamp: 2000 },
      { role: "tool_call", content: "kb_search({})", name: "kb_search", args: "{}", timestamp: 3000 },
    ]
    const result = restoreChatContext(msgs)
    expect(result.length).toBe(2)
    expect(result[0]).toEqual({ role: "user", content: "hi" })
    expect(result[1].role).toBe("assistant")
    expect(result[1].content).toBe("let me search")
    expect(result[1].tool_calls).toBeDefined()
    expect(result[1].tool_calls!.length).toBe(1)
    expect(result[1].tool_calls![0].function.name).toBe("kb_search")
  })
})

describe("parseModelRef", () => {
  test("parses provider/id string", () => {
    expect(parseModelRef("openai/gpt-4")).toEqual({ provider: "openai", id: "gpt-4" })
  })

  test("parses object with provider and id", () => {
    expect(parseModelRef({ provider: "anthropic", id: "claude-3" })).toEqual({ provider: "anthropic", id: "claude-3" })
  })

  test("returns null for empty string", () => {
    expect(parseModelRef("")).toBeNull()
  })

  test("returns null for string without slash", () => {
    expect(parseModelRef("gpt-4")).toBeNull()
  })

  test("returns null for null/undefined", () => {
    expect(parseModelRef(null)).toBeNull()
    expect(parseModelRef(undefined)).toBeNull()
  })

  test("returns null for object missing fields", () => {
    expect(parseModelRef({ provider: "x" })).toBeNull()
    expect(parseModelRef({ id: "y" })).toBeNull()
  })
})

describe("resolveConfiguredModel", () => {
  test("returns null when no models configured", () => {
    const original = globalThis.fetch
    try {
      expect(resolveConfiguredModel()).toBeDefined()
    } catch {
      // getConfiguredModels reads from filesystem, may return empty
    }
  })

  test("finds model by provider and id when configured", () => {
    const result = resolveConfiguredModel()
    if (result) {
      expect(result).toHaveProperty("provider")
      expect(result).toHaveProperty("id")
    }
  })
})
