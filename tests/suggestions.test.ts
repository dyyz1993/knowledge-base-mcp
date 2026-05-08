import { describe, test, expect } from "bun:test"

function parseSuggestions(content: string): { suggestions: string[]; cleanContent: string } {
  const closedMatch = content.match(/\[SUGGESTIONS\]\r?\n([\s\S]*?)\[\/SUGGESTIONS\]/)
  const openMatch = !closedMatch ? content.match(/\[SUGGESTIONS\]\r?\n([\s\S]+)$/) : null
  const match = closedMatch || openMatch
  if (!match) return { suggestions: [], cleanContent: content }

  const cleanContent = content.replace(match[0], "").trim()
  const suggestions = match[1]
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => /^\d+\.\s/.test(l) || /^[-•]\s/.test(l))
    .map(l => l.replace(/^(\d+\.|[-•])\s*/, ""))
    .filter(s => s.length > 0 && s.length <= 60)
    .slice(0, 3)

  return { suggestions, cleanContent }
}

describe("standard closed format", () => {
  test("parses numbered suggestions from closed tag", () => {
    const input = "这是回答内容\n[SUGGESTIONS]\n1. 深入了解React Hooks\n2. 查看状态管理方案\n[/SUGGESTIONS]"
    const { suggestions, cleanContent } = parseSuggestions(input)
    expect(suggestions).toEqual(["深入了解React Hooks", "查看状态管理方案"])
    expect(cleanContent).toBe("这是回答内容")
  })
})

describe("unclosed format", () => {
  test("parses suggestions without closing tag (streaming)", () => {
    const input = "这是回答内容\n[SUGGESTIONS]\n1. 第一个建议\n2. 第二个建议"
    const { suggestions } = parseSuggestions(input)
    expect(suggestions).toEqual(["第一个建议", "第二个建议"])
  })
})

describe("CRLF compatibility", () => {
  test("handles \\r\\n line endings", () => {
    const input = "content\r\n[SUGGESTIONS]\r\n1. 建议一\r\n2. 建议二\r\n[/SUGGESTIONS]"
    const { suggestions } = parseSuggestions(input)
    expect(suggestions).toEqual(["建议一", "建议二"])
  })
})

describe("bullet format", () => {
  test("parses dash bullet list", () => {
    const input = "[SUGGESTIONS]\n- 建议A\n- 建议B\n[/SUGGESTIONS]"
    const { suggestions } = parseSuggestions(input)
    expect(suggestions).toEqual(["建议A", "建议B"])
  })

  test("parses • bullet list", () => {
    const input = "[SUGGESTIONS]\n• 建议X\n• 建议Y\n[/SUGGESTIONS]"
    const { suggestions } = parseSuggestions(input)
    expect(suggestions).toEqual(["建议X", "建议Y"])
  })
})

describe("empty suggestions filtered", () => {
  test("lines with no content after marker are removed", () => {
    const input = "[SUGGESTIONS]\n1. \n2. \n[/SUGGESTIONS]"
    const { suggestions } = parseSuggestions(input)
    expect(suggestions).toEqual([])
  })
})

describe("long suggestion filtered", () => {
  test("suggestions over 60 chars are excluded", () => {
    const long = "a".repeat(61)
    const input = `[SUGGESTIONS]\n1. ${long}\n2. short\n[/SUGGESTIONS]`
    const { suggestions } = parseSuggestions(input)
    expect(suggestions).toEqual(["short"])
  })
})

describe("max 3 suggestions", () => {
  test("only first 3 suggestions kept", () => {
    const input = "[SUGGESTIONS]\n1. a\n2. b\n3. c\n4. d\n[/SUGGESTIONS]"
    const { suggestions } = parseSuggestions(input)
    expect(suggestions).toEqual(["a", "b", "c"])
  })
})

describe("no suggestions in plain text", () => {
  test("returns empty array for normal content", () => {
    const input = "这是一段普通的回答，没有任何建议标记。"
    const { suggestions, cleanContent } = parseSuggestions(input)
    expect(suggestions).toEqual([])
    expect(cleanContent).toBe(input)
  })
})

describe("cleanContent strips suggestion tags", () => {
  test("returned content has no [SUGGESTIONS] markers", () => {
    const input = "正文内容\n[SUGGESTIONS]\n1. 建议\n[/SUGGESTIONS]"
    const { cleanContent } = parseSuggestions(input)
    expect(cleanContent).not.toContain("[SUGGESTIONS]")
    expect(cleanContent).not.toContain("[/SUGGESTIONS]")
    expect(cleanContent).toBe("正文内容")
  })
})

describe("suggestions after markdown code block", () => {
  test("parses suggestions following code block", () => {
    const input = "```ts\nconst x = 1\n```\n\n以上是代码。\n[SUGGESTIONS]\n1. 了解更多TS技巧\n2. 查看相关文档\n[/SUGGESTIONS]"
    const { suggestions, cleanContent } = parseSuggestions(input)
    expect(suggestions).toEqual(["了解更多TS技巧", "查看相关文档"])
    expect(cleanContent).toContain("```ts")
    expect(cleanContent).not.toContain("[SUGGESTIONS]")
  })
})
