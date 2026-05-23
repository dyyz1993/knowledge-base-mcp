import { test, expect, describe } from "bun:test"
import { buildTree, stripHtmlTags } from "../src/chat/tools/helpers"
import type { OpenAITool } from "../src/chat/tools/types"
import { toolDefinitions } from "../src/chat/tools/index"

describe("helpers: buildTree", () => {
  test("should build tree from flat file paths", () => {
    const lines = ["./src/index.ts", "./src/config.ts"]
    const result = buildTree(lines)

    expect(result).toContain("src/")
    expect(result).toContain("index.ts")
    expect(result).toContain("config.ts")
  })

  test("should handle empty input", () => {
    expect(buildTree([])).toBe("")
  })

  test("should handle nested directories", () => {
    const lines = ["./src/chat/tools/helpers.ts", "./src/chat/session.ts"]
    const result = buildTree(lines)

    expect(result).toContain("chat/")
    expect(result).toContain("helpers.ts")
    expect(result).toContain("session.ts")
  })

  test("should strip leading ./ from paths", () => {
    const lines = ["./src/main.ts"]
    const result = buildTree(lines)

    expect(result).toContain("src/")
    expect(result).toContain("main.ts")
  })

  test("should skip empty lines", () => {
    const lines = ["./src/a.ts", "", "./src/b.ts"]
    const result = buildTree(lines)

    expect(result).toContain("a.ts")
    expect(result).toContain("b.ts")
  })

  test("should handle files in root directory", () => {
    const lines = ["./Makefile"]
    const result = buildTree(lines)

    expect(result).toContain("Makefile")
  })

  test("should group files by directory", () => {
    const lines = ["./src/a.ts", "./src/b.ts", "./test/a.test.ts"]
    const result = buildTree(lines)

    const srcCount = (result.match(/src\//g) || []).length
    expect(srcCount).toBe(1)
  })
})

describe("helpers: stripHtmlTags", () => {
  test("should remove basic HTML tags", () => {
    expect(stripHtmlTags("<p>Hello</p>")).toBe("Hello")
  })

  test("should remove script tags and content", () => {
    const html = '<p>Hello</p><script>alert("xss")</script><p>World</p>'
    const result = stripHtmlTags(html)
    expect(result).toBe("Hello\nWorld")
  })

  test("should remove style tags and content", () => {
    const html = "<p>Hello</p><style>body { color: red; }</style><p>World</p>"
    const result = stripHtmlTags(html)
    expect(result).toBe("Hello\nWorld")
  })

  test("should convert <br> to newlines", () => {
    expect(stripHtmlTags("Hello<br>World")).toBe("Hello\nWorld")
  })

  test("should convert closing </p> to newlines", () => {
    expect(stripHtmlTags("<p>Hello</p><p>World</p>")).toBe("Hello\nWorld")
  })

  test("should decode HTML entities", () => {
    expect(stripHtmlTags("&amp; &lt; &gt; &quot;")).toBe('& < > "')
  })

  test("should collapse multiple newlines", () => {
    const html = "<p>A</p><p>B</p><p>C</p><p>D</p>"
    const result = stripHtmlTags(html)
    expect(result).not.toMatch(/\n{3,}/)
  })

  test("should handle complex HTML", () => {
    const html = `
      <html>
        <head><title>Test</title></head>
        <body>
          <h1>Title</h1>
          <div class="content">
            <p>Paragraph 1</p>
            <p>Paragraph 2</p>
          </div>
        </body>
      </html>
    `
    const result = stripHtmlTags(html)
    expect(result).toContain("Title")
    expect(result).toContain("Paragraph 1")
    expect(result).toContain("Paragraph 2")
    expect(result).not.toContain("<")
  })

  test("should return empty string for empty input", () => {
    expect(stripHtmlTags("")).toBe("")
  })

  test("should return plain text unchanged", () => {
    expect(stripHtmlTags("Hello World")).toBe("Hello World")
  })

  test("should convert heading closing tags to newlines", () => {
    const html = "<h1>Title</h1><h2>Subtitle</h2>"
    const result = stripHtmlTags(html)
    expect(result).toContain("Title")
    expect(result).toContain("Subtitle")
    expect(result).not.toContain("<h")
  })
})

describe("tool definitions structure", () => {
  test("should export valid OpenAITool definitions", () => {
    for (const def of toolDefinitions) {
      expect(def.type).toBe("function")
      expect(def.function.name).toBeTruthy()
      expect(def.function.description).toBeTruthy()
      expect(def.function.parameters).toBeDefined()
      expect(def.function.parameters.type).toBe("object")
    }
  })

  test("should include all expected kb tools", () => {
    const names = toolDefinitions.map(d => d.function.name)
    expect(names).toContain("kb_search")
    expect(names).toContain("kb_read")
    expect(names).toContain("kb_list")
    expect(names).toContain("kb_write")
    expect(names).toContain("kb_outline")
  })

  test("should include scan_project tool", () => {
    const names = toolDefinitions.map(d => d.function.name)
    expect(names).toContain("scan_project")
  })

  test("should include url_fetch tool", () => {
    const names = toolDefinitions.map(d => d.function.name)
    expect(names).toContain("url_fetch")
  })

  test("should include git_clone tool", () => {
    const names = toolDefinitions.map(d => d.function.name)
    expect(names).toContain("git_clone")
  })

  test("should include run_script tool", () => {
    const names = toolDefinitions.map(d => d.function.name)
    expect(names).toContain("run_script")
  })

  test("should include kb_research tool", () => {
    const names = toolDefinitions.map(d => d.function.name)
    expect(names).toContain("kb_research")
  })

  test("kb_search should have required query parameter", () => {
    const kbSearch = toolDefinitions.find(d => d.function.name === "kb_search")!
    const props = kbSearch.function.parameters.properties as Record<string, unknown>
    expect(props.query).toBeDefined()
    expect((kbSearch.function.parameters as Record<string, unknown>).required).toContain("query")
  })

  test("kb_read should have required id parameter", () => {
    const kbRead = toolDefinitions.find(d => d.function.name === "kb_read")!
    const props = kbRead.function.parameters.properties as Record<string, unknown>
    expect(props.id).toBeDefined()
    expect((kbRead.function.parameters as Record<string, unknown>).required).toContain("id")
  })

  test("kb_write should have all required fields", () => {
    const kbWrite = toolDefinitions.find(d => d.function.name === "kb_write")!
    const required = (kbWrite.function.parameters as Record<string, unknown>).required as string[]
    expect(required).toContain("title")
    expect(required).toContain("content")
    expect(required).toContain("tags")
    expect(required).toContain("keywords")
    expect(required).toContain("intent")
    expect(required).toContain("project_description")
  })

  test("kb_outline should have required project parameter", () => {
    const kbOutline = toolDefinitions.find(d => d.function.name === "kb_outline")!
    const props = kbOutline.function.parameters.properties as Record<string, unknown>
    expect(props.project).toBeDefined()
    expect((kbOutline.function.parameters as Record<string, unknown>).required).toContain("project")
  })
})

describe("OpenAITool type structure", () => {
  test("should conform to OpenAI function calling format", () => {
    const tool: OpenAITool = {
      type: "function",
      function: {
        name: "test_tool",
        description: "A test tool",
        parameters: {
          type: "object",
          properties: {
            input: { type: "string", description: "test input" },
          },
        },
      },
    }

    expect(tool.type).toBe("function")
    expect(tool.function.name).toBe("test_tool")
    expect(tool.function.parameters.type).toBe("object")
  })
})
