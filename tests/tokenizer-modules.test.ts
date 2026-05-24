import { describe, test, expect } from "bun:test"
import { tokenize, STOP_WORDS } from "../src/utils/tokenizer"
import { validateRegexPattern, safeRegexExec, safeRegexTest } from "../src/utils/regex-safety"

describe("tokenizer", () => {
  test("should tokenize English text", () => {
    const tokens = tokenize("Hello world this is a test")
    expect(tokens).toContain("hello")
    expect(tokens).toContain("world")
    expect(tokens).toContain("test")
  })

  test("should tokenize Chinese with Intl.Segmenter", () => {
    const tokens = tokenize("这是一个测试", { bigram: true })
    expect(tokens.length).toBeGreaterThan(0)
  })

  test("should handle mixed CJK + English", () => {
    const tokens = tokenize("React 开发指南", { bigram: true })
    const hasChinese = tokens.some(t => /[\u4e00-\u9fff]/.test(t))
    const hasEnglish = tokens.some(t => /[a-z]/.test(t))
    expect(hasChinese || hasEnglish).toBe(true)
  })

  test("should respect lowercase option", () => {
    const lower = tokenize("Hello World")
    const upper = tokenize("Hello World", { lowercase: false })
    expect(lower).toContain("hello")
    expect(lower).toContain("world")
    expect(upper).toContain("Hello")
    expect(upper).toContain("World")
  })

  test("should handle empty string", () => {
    expect(tokenize("")).toEqual([])
  })

  test("should handle special characters", () => {
    const tokens = tokenize("hello@world.com #test $100")
    expect(tokens.length).toBeGreaterThan(0)
  })

  test("should extract keywords from text", () => {
    const tokens = tokenize("React hooks TypeScript", { removeStopWords: true })
    expect(tokens).toContain("react")
    expect(tokens).toContain("hooks")
    expect(tokens).toContain("typescript")
  })

  test("should remove stop words when option enabled", () => {
    const withStop = tokenize("this is a test", { removeStopWords: false })
    const withoutStop = tokenize("this is a test", { removeStopWords: true })
    expect(withStop.length).toBeGreaterThan(withoutStop.length)
  })

  test("should respect minTokenLength", () => {
    const tokens = tokenize("a ab abc", { minTokenLength: 3 })
    expect(tokens).not.toContain("a")
    expect(tokens).not.toContain("ab")
    expect(tokens).toContain("abc")
  })

  test("should split on custom splitChars", () => {
    const tokens = tokenize("hello/world/test", { splitChars: "/" })
    expect(tokens).toContain("hello")
    expect(tokens).toContain("world")
    expect(tokens).toContain("test")
  })

  test("STOP_WORDS should include common English and Chinese words", () => {
    expect(STOP_WORDS.has("the")).toBe(true)
    expect(STOP_WORDS.has("的")).toBe(true)
    expect(STOP_WORDS.has("is")).toBe(true)
  })
})

describe("regex-safety", () => {
  test("should accept safe patterns", () => {
    const result = validateRegexPattern("^hello.*world$")
    expect(result.safe).toBe(true)
  })

  test("should reject overly long patterns", () => {
    const longPattern = "a".repeat(501)
    const result = validateRegexPattern(longPattern)
    expect(result.safe).toBe(false)
    expect(result.reason).toContain("too long")
  })

  test("should reject nested quantifiers", () => {
    const result = validateRegexPattern("(a+)+")
    expect(result.safe).toBe(false)
    expect(result.reason).toContain("dangerous")
  })

  test("should reject alternation with quantifiers", () => {
    const result = validateRegexPattern("(a|b)+")
    expect(result.safe).toBe(false)
  })

  test("should allow simple patterns", () => {
    expect(validateRegexPattern("hello").safe).toBe(true)
    expect(validateRegexPattern("\\d+").safe).toBe(true)
    expect(validateRegexPattern("[a-z]+").safe).toBe(true)
  })

  test("safeRegexExec should work with safe patterns", () => {
    const result = safeRegexExec(/hello/, "hello world")
    expect(result).not.toBeNull()
    expect(result![0]).toBe("hello")
  })

  test("safeRegexTest should work with safe patterns", () => {
    expect(safeRegexTest(/\d+/, "abc123")).toBe(true)
    expect(safeRegexTest(/\d+/, "abc")).toBe(false)
  })

  test("safeRegexExec should throw for unsafe patterns", () => {
    expect(() => safeRegexExec(/(a+)+/, "test")).toThrow("Unsafe regex")
  })

  test("safeRegexTest should throw for unsafe patterns", () => {
    expect(() => safeRegexTest(/(a+)+/, "test")).toThrow("Unsafe regex")
  })

  test("should accept patterns at boundary length (500 chars)", () => {
    const pattern = "a".repeat(500)
    expect(validateRegexPattern(pattern).safe).toBe(true)
  })

  test("should reject patterns just over boundary (501 chars)", () => {
    const pattern = "a".repeat(501)
    expect(validateRegexPattern(pattern).safe).toBe(false)
  })
})
