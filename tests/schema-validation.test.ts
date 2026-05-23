import { test, expect, describe } from "bun:test"
import { ZodError } from "zod"
import {
  getDocByIdSchema,
  recentDocsQuerySchema,
  writeDocSchema,
  semanticSearchSchema,
  searchSchema,
  kbAskSchema,
  askSearchSchema,
  webReadSchema,
  kbIngestSchema,
  deepReadSchema,
  summarizeSchema,
  workKeySchema,
  agentResearchSchema,
  ingestSiteSchema,
  statsResetSchema,
  researchEvolveSchema,
  readDocByIdSchema,
  outlineQuerySchema,
} from "../src/http/schemas"
import { formatZodError, validateBody } from "../src/http/validate"

describe("validateBody", () => {
  test("should return parsed data for valid input", () => {
    const result = validateBody(getDocByIdSchema, { id: "abc123" })
    expect(result.id).toBe("abc123")
  })

  test("should throw ZodError for invalid input", () => {
    expect(() => validateBody(getDocByIdSchema, {})).toThrow()
  })

  test("should throw ZodError for wrong types", () => {
    expect(() => validateBody(getDocByIdSchema, { id: 123 })).toThrow()
  })
})

describe("formatZodError", () => {
  test("should format single error", () => {
    try {
      getDocByIdSchema.parse({})
    } catch (e) {
      expect(e).toBeInstanceOf(ZodError)
      const formatted = formatZodError(e as ZodError)
      expect(formatted).toContain("id")
    }
  })

  test("should format multiple errors separated by semicolons", () => {
    try {
      writeDocSchema.parse({ title: "", content: "" })
    } catch (e) {
      expect(e).toBeInstanceOf(ZodError)
      const formatted = formatZodError(e as ZodError)
      expect(formatted).toContain(";")
    }
  })

  test("should include field path in error", () => {
    try {
      searchSchema.parse({ query: "a".repeat(2001) })
    } catch (e) {
      expect(e).toBeInstanceOf(ZodError)
      const formatted = formatZodError(e as ZodError)
      expect(formatted).toContain("query")
    }
  })
})

describe("getDocByIdSchema", () => {
  test("should accept valid id", () => {
    const result = getDocByIdSchema.parse({ id: "doc-123" })
    expect(result.id).toBe("doc-123")
  })

  test("should reject empty id", () => {
    expect(() => getDocByIdSchema.parse({ id: "" })).toThrow()
  })

  test("should reject too long id", () => {
    expect(() => getDocByIdSchema.parse({ id: "a".repeat(201) })).toThrow()
  })

  test("should reject missing id", () => {
    expect(() => getDocByIdSchema.parse({})).toThrow()
  })
})

describe("recentDocsQuerySchema", () => {
  test("should use default values", () => {
    const result = recentDocsQuerySchema.parse({})
    expect(result.hours).toBe(24)
    expect(result.limit).toBe(50)
    expect(result.include_content).toBe(false)
    expect(result.format).toBe("json")
  })

  test("should accept valid hours", () => {
    const result = recentDocsQuerySchema.parse({ hours: 48 })
    expect(result.hours).toBe(48)
  })

  test("should reject hours over 8760", () => {
    expect(() => recentDocsQuerySchema.parse({ hours: 9000 })).toThrow()
  })

  test("should accept string hours and coerce to number", () => {
    const result = recentDocsQuerySchema.parse({ hours: "12" })
    expect(result.hours).toBe(12)
  })

  test("should coerce include_content from string 'true'", () => {
    const result = recentDocsQuerySchema.parse({ include_content: "true" })
    expect(result.include_content).toBe(true)
  })

  test("should set include_content to false for non-'true' string", () => {
    const result = recentDocsQuerySchema.parse({ include_content: "false" })
    expect(result.include_content).toBe(false)
  })

  test("should accept html format", () => {
    const result = recentDocsQuerySchema.parse({ format: "html" })
    expect(result.format).toBe("html")
  })

  test("should reject invalid format", () => {
    expect(() => recentDocsQuerySchema.parse({ format: "xml" })).toThrow()
  })
})

describe("writeDocSchema", () => {
  const validInput = {
    title: "Test Doc",
    content: "Some content here",
    tags: ["tutorial"],
    keywords: ["test"],
  }

  test("should accept valid input with required fields", () => {
    const result = writeDocSchema.parse(validInput)
    expect(result.title).toBe("Test Doc")
    expect(result.content).toBe("Some content here")
  })

  test("should fill defaults for optional fields", () => {
    const result = writeDocSchema.parse(validInput)
    expect(result.intent).toBe("")
    expect(result.project_description).toBe("")
    expect(result.related_projects).toEqual([])
    expect(result.related_files).toEqual([])
  })

  test("should reject empty title", () => {
    expect(() => writeDocSchema.parse({ ...validInput, title: "" })).toThrow()
  })

  test("should reject empty content", () => {
    expect(() => writeDocSchema.parse({ ...validInput, content: "" })).toThrow()
  })

  test("should reject too many tags (>20)", () => {
    const manyTags = Array(21).fill("tag")
    expect(() => writeDocSchema.parse({ ...validInput, tags: manyTags })).toThrow()
  })

  test("should reject content exceeding 500000 chars", () => {
    expect(() => writeDocSchema.parse({ ...validInput, content: "x".repeat(500001) })).toThrow()
  })
})

describe("semanticSearchSchema", () => {
  test("should accept valid query", () => {
    const result = semanticSearchSchema.parse({ query: "search term" })
    expect(result.query).toBe("search term")
    expect(result.limit).toBe(10)
  })

  test("should reject empty query", () => {
    expect(() => semanticSearchSchema.parse({ query: "" })).toThrow()
  })

  test("should reject limit over 100", () => {
    expect(() => semanticSearchSchema.parse({ query: "test", limit: 101 })).toThrow()
  })

  test("should reject limit under 1", () => {
    expect(() => semanticSearchSchema.parse({ query: "test", limit: 0 })).toThrow()
  })
})

describe("searchSchema", () => {
  test("should accept empty object", () => {
    const result = searchSchema.parse({})
    expect(result.query).toBeUndefined()
  })

  test("should accept valid query with keywords", () => {
    const result = searchSchema.parse({ query: "test", keywords: ["a", "b"] })
    expect(result.query).toBe("test")
    expect(result.keywords).toEqual(["a", "b"])
  })

  test("should accept tags filter", () => {
    const result = searchSchema.parse({ tags: ["tutorial", "guide"] })
    expect(result.tags).toEqual(["tutorial", "guide"])
  })
})

describe("kbAskSchema", () => {
  test("should use default max_web_results", () => {
    const result = kbAskSchema.parse({ query: "test" })
    expect(result.max_web_results).toBe(3)
  })

  test("should reject max_web_results over 20", () => {
    expect(() => kbAskSchema.parse({ query: "test", max_web_results: 21 })).toThrow()
  })

  test("should accept custom max_web_results", () => {
    const result = kbAskSchema.parse({ query: "test", max_web_results: 10 })
    expect(result.max_web_results).toBe(10)
  })
})

describe("askSearchSchema", () => {
  test("should accept query without model", () => {
    const result = askSearchSchema.parse({ query: "test" })
    expect(result.query).toBe("test")
    expect(result.model).toBeUndefined()
  })

  test("should accept query with model", () => {
    const result = askSearchSchema.parse({
      query: "test",
      model: { provider: "openai", id: "gpt-4" },
    })
    expect(result.model).toEqual({ provider: "openai", id: "gpt-4" })
  })
})

describe("webReadSchema", () => {
  test("should accept valid URL", () => {
    const result = webReadSchema.parse({ url: "https://example.com" })
    expect(result.url).toBe("https://example.com")
  })

  test("should reject empty URL", () => {
    expect(() => webReadSchema.parse({ url: "" })).toThrow()
  })

  test("should reject too long URL", () => {
    expect(() => webReadSchema.parse({ url: "x".repeat(2049) })).toThrow()
  })
})

describe("kbIngestSchema", () => {
  test("should accept valid input", () => {
    const result = kbIngestSchema.parse({
      title: "Test",
      content: "Content",
    })
    expect(result.title).toBe("Test")
  })

  test("should accept optional url", () => {
    const result = kbIngestSchema.parse({
      url: "https://example.com",
      title: "Test",
      content: "Content",
    })
    expect(result.url).toBe("https://example.com")
  })
})

describe("agentResearchSchema", () => {
  test("should default mode to standard", () => {
    const result = agentResearchSchema.parse({ query: "research topic" })
    expect(result.mode).toBe("standard")
  })

  test("should accept valid modes", () => {
    for (const mode of ["quick", "standard", "deep"] as const) {
      const result = agentResearchSchema.parse({ query: "test", mode })
      expect(result.mode).toBe(mode)
    }
  })

  test("should reject invalid mode", () => {
    expect(() => agentResearchSchema.parse({ query: "test", mode: "invalid" })).toThrow()
  })
})

describe("ingestSiteSchema", () => {
  test("should transform maxPages from string to number", () => {
    const result = ingestSiteSchema.parse({ url: "https://example.com", maxPages: "20" })
    expect(result.maxPages).toBe(20)
  })

  test("should clamp maxPages to 1-100 range", () => {
    const result = ingestSiteSchema.parse({ url: "https://example.com", maxPages: 200 })
    expect(result.maxPages).toBe(100)
  })

  test("should default maxPages to 10 when falsy", () => {
    const result = ingestSiteSchema.parse({ url: "https://example.com", maxPages: 0 })
    expect(result.maxPages).toBe(10)
  })

  test("should transform concurrency from string", () => {
    const result = ingestSiteSchema.parse({ url: "https://example.com", concurrency: "5" })
    expect(result.concurrency).toBe(5)
  })

  test("should clamp concurrency to 1-10", () => {
    const result = ingestSiteSchema.parse({ url: "https://example.com", concurrency: 20 })
    expect(result.concurrency).toBe(10)
  })
})

describe("statsResetSchema", () => {
  test("should default type to all", () => {
    const result = statsResetSchema.parse({})
    expect(result.type).toBe("all")
  })

  test("should accept valid types", () => {
    for (const type of ["search", "llm", "embedding", "mcp", "all"] as const) {
      const result = statsResetSchema.parse({ type })
      expect(result.type).toBe(type)
    }
  })

  test("should reject invalid type", () => {
    expect(() => statsResetSchema.parse({ type: "invalid" })).toThrow()
  })
})

describe("researchEvolveSchema", () => {
  test("should use default maxCycles", () => {
    const result = researchEvolveSchema.parse({})
    expect(result.maxCycles).toBe(3)
  })

  test("should reject maxCycles over 20", () => {
    expect(() => researchEvolveSchema.parse({ maxCycles: 21 })).toThrow()
  })
})

describe("readDocByIdSchema", () => {
  test("should accept valid id", () => {
    const result = readDocByIdSchema.parse({ id: "abc" })
    expect(result.id).toBe("abc")
  })

  test("should reject empty id", () => {
    expect(() => readDocByIdSchema.parse({ id: "" })).toThrow()
  })
})

describe("outlineQuerySchema", () => {
  test("should accept valid project path", () => {
    const result = outlineQuerySchema.parse({ project: "/home/user/project" })
    expect(result.project).toBe("/home/user/project")
  })

  test("should reject empty project", () => {
    expect(() => outlineQuerySchema.parse({ project: "" })).toThrow()
  })
})

describe("summarizeSchema", () => {
  test("should accept valid input", () => {
    const result = summarizeSchema.parse({
      content: "Some content",
      title: "Test Title",
    })
    expect(result.content).toBe("Some content")
    expect(result.title).toBe("Test Title")
  })

  test("should reject empty content", () => {
    expect(() => summarizeSchema.parse({ content: "", title: "Test" })).toThrow()
  })
})

describe("workKeySchema", () => {
  test("should accept valid input", () => {
    const result = workKeySchema.parse({
      query: "test query",
      results: [{ title: "Result 1" }],
    })
    expect(result.query).toBe("test query")
    expect(result.results).toHaveLength(1)
  })

  test("should reject empty results", () => {
    expect(() => workKeySchema.parse({ query: "test", results: [] })).toThrow()
  })

  test("should reject too many results (>50)", () => {
    const results = Array(51).fill({ title: "R" })
    expect(() => workKeySchema.parse({ query: "test", results })).toThrow()
  })
})

describe("deepReadSchema", () => {
  test("should accept valid url", () => {
    const result = deepReadSchema.parse({ url: "https://example.com/page" })
    expect(result.url).toBe("https://example.com/page")
  })

  test("should reject empty url", () => {
    expect(() => deepReadSchema.parse({ url: "" })).toThrow()
  })
})
