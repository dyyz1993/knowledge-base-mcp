import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test"
import { executeTool } from "../src/chat/tools"
import { executeRunScript } from "../src/chat/tools/run-script"
import { executeReadFile, executeGrepSearch } from "../src/chat/tools/file-search"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

let tempDir: string

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "kb-test-"))
})

afterEach(() => {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true })
})

describe("chat tools dispatch", () => {
  test("should dispatch to correct tool handler", async () => {
    const result = await executeTool("run_script", {
      language: "bun",
      code: "console.log('dispatch-ok')",
    })
    expect(result).toContain("dispatch-ok")
  })

  test("should handle unknown tool gracefully", async () => {
    const result = await executeTool("nonexistent_tool_xyz", {})
    expect(result).toBe("Unknown tool: nonexistent_tool_xyz")
  })

  test("should pass arguments correctly", async () => {
    const result = await executeTool("run_script", {
      language: "bun",
      code: "console.log(JSON.stringify({a:1}))",
    })
    expect(result).toContain('"a":1')
  })

  test("should handle tool execution errors", async () => {
    const result = await executeTool("read_file", { path: "/absolutely/does/not/exist.txt" })
    expect(result).toContain("not found")
  })

  test("should return structured result", async () => {
    const result = await executeTool("run_script", {
      language: "bun",
      code: "console.log('hello')",
    })
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  test("should validate tool arguments", async () => {
    const result = await executeTool("run_script", { language: "", code: "" })
    expect(result).toContain("required")
  })
})

describe("run-script security", () => {
  test("should reject dangerous commands: writeFile", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `import { writeFileSync } from "fs"; writeFileSync("/tmp/evil", "x")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject dangerous commands: spawn", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `import { spawn } from "child_process"; spawn("rm", ["-rf", "/"])`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject dangerous commands: fork", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `process.fork("/etc/passwd")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject dangerous commands: mkdir", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `require("fs").mkdirSync("/tmp/evil-dir")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject dangerous commands: unlink", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `require("fs").unlinkSync("/tmp/x")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject dangerous commands: rename", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `require("fs").renameSync("a", "b")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject dangerous commands: chmod", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `require("fs").chmodSync("a", 0o777)`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject dangerous commands: rmdir", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `require("fs").rmdirSync("/tmp/x")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject child_process import", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `require("child_process")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should reject exec( pattern", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `const { exec } = require("child_process"); exec("ls")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should limit output size to 5000 chars", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `console.log("x".repeat(10000))`,
    })
    expect(result.length).toBeLessThanOrEqual(5000)
  })

  test("should handle non-zero exit codes", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `process.exit(1)`,
    })
    expect(result).toContain("脚本执行错误")
  })

  test("should handle syntax errors", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `this is not valid javascript !!!`,
    })
    expect(result).toContain("脚本执行错误")
  })

  test("should execute bun scripts successfully", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `console.log("bun-works")`,
    })
    expect(result).toContain("bun-works")
  })

  test("should execute python scripts successfully", async () => {
    const result = await executeRunScript({
      language: "python",
      code: `print("python-works")`,
    })
    expect(result).toContain("python-works")
  })

  test("should require language and code", async () => {
    const result = await executeRunScript({ language: "", code: "" })
    expect(result).toContain("required")
  })

  test("should return fallback message when no output", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `const x = 1`,
    })
    expect(result).toContain("脚本执行成功，无输出")
  })

  test("should reject writeSync", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `require("fs").writeSync(1, "evil")`,
    })
    expect(result).toContain("安全限制")
  })

  test("should handle runtime errors with stack traces", async () => {
    const result = await executeRunScript({
      language: "bun",
      code: `throw new Error("test-error")`,
    })
    expect(result).toContain("test-error")
  })
})

describe("kb-tools", () => {
  test("should search knowledge base and return results or empty", async () => {
    const result = await executeTool("kb_search", { query: "zzzzz-nonexistent-topic-xyz-12345" })
    expect(typeof result).toBe("string")
    expect(result.length).toBeGreaterThan(0)
  })

  test("should require query for kb_search", async () => {
    const result = await executeTool("kb_search", { query: "" })
    expect(result).toContain("required")
  })

  test("should require id for kb_read", async () => {
    const result = await executeTool("kb_read", { id: "" })
    expect(result).toContain("required")
  })

  test("should handle missing document gracefully", async () => {
    const result = await executeTool("kb_read", { id: "nonexistent-id-xyz-99999" })
    expect(result).toContain("not found")
  })

  test("should validate required fields before kb_write", async () => {
    const result = await executeTool("kb_write", {
      title: "Test",
      content: "content",
    })
    expect(result).toContain("Missing required fields")
    expect(result).toContain("tags")
    expect(result).toContain("keywords")
    expect(result).toContain("intent")
    expect(result).toContain("project_description")
    expect(result).toContain("project_path")
    expect(result).toContain("related_projects")
    expect(result).toContain("related_files")
  })

  test("should require title and content for kb_write", async () => {
    const result = await executeTool("kb_write", {
      title: "",
      content: "",
      tags: ["reference"],
      keywords: ["test"],
      intent: "test",
      project_description: "test",
      project_path: "/test",
      related_projects: [],
      related_files: [],
    })
    expect(result).toContain("required")
  })

  test("should require project for kb_outline", async () => {
    const result = await executeTool("kb_outline", { project: "" })
    expect(result).toContain("required")
  })

  test("should handle non-existent project outline", async () => {
    const result = await executeTool("kb_outline", { project: "/zzzzz-no-such-project" })
    expect(result).toContain("No knowledge base outline found")
  })

  test("should write document to knowledge base", async () => {
    const result = await executeTool("kb_write", {
      title: "Test Doc for KB Tools",
      content: "This is test content for the knowledge base.",
      tags: ["test", "reference"],
      keywords: ["test", "knowledge-base"],
      intent: "Unit test for kb_write tool",
      project_description: "knowledge-base-mcp",
      project_path: "/test/project",
      related_projects: ["other-project"],
      related_files: ["src/test.ts"],
    })
    expect(result).toContain("Saved to knowledge base")
    expect(result).toContain("Test Doc for KB Tools")
    expect(result).toContain("test, reference")
  })

  test("should read written document", async () => {
    const writeResult = await executeTool("kb_write", {
      title: "Readable Test Doc",
      content: "Content for reading test.",
      tags: ["test"],
      keywords: ["readable"],
      intent: "Test read after write",
      project_description: "test-project",
      project_path: "/test/read",
      related_projects: ["some-project"],
      related_files: ["src/test.ts"],
    })
    const idMatch = writeResult.match(/ID:\s*(\S+)/)
    expect(idMatch).toBeTruthy()
    const id = idMatch![1]
    const readResult = await executeTool("kb_read", { id })
    expect(readResult).toContain("Readable Test Doc")
    expect(readResult).toContain("Content for reading test.")
  })

  test("should list documents", async () => {
    const result = await executeTool("kb_list", {})
    expect(typeof result).toBe("string")
  })

  test("should list documents with tag filter", async () => {
    const result = await executeTool("kb_list", { tag: "nonexistent-tag-xyz" })
    expect(result).toContain("No documents found")
  })
})

describe("file-search tools", () => {
  test("should find files matching pattern via grep", async () => {
    writeFileSync(join(tempDir, "sample.txt"), "hello world\nfoo bar\nhello again\n")

    const result = await executeGrepSearch({
      pattern: "hello",
      path: tempDir,
      include: "*.txt",
      max_results: 10,
    })
    expect(result).toContain("hello")
  })

  test("should read file content", async () => {
    const filePath = join(tempDir, "read-test.txt")
    writeFileSync(filePath, "line1\nline2\nline3\n")

    const result = await executeReadFile({ path: filePath })
    expect(result).toContain("line1")
    expect(result).toContain("line2")
    expect(result).toContain("line3")
  })

  test("should read file with offset and limit", async () => {
    const filePath = join(tempDir, "offset-test.txt")
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`)
    writeFileSync(filePath, lines.join("\n"))

    const result = await executeReadFile({ path: filePath, offset: 5, limit: 3 })
    expect(result).toContain("line6")
    expect(result).toContain("line7")
    expect(result).toContain("line8")
    expect(result).not.toContain("line5")
    expect(result).not.toContain("line9")
  })

  test("should handle non-existent files", async () => {
    const result = await executeReadFile({ path: "/no/such/file.txt" })
    expect(result).toContain("not found")
  })

  test("should require path for read_file", async () => {
    const result = await executeReadFile({ path: "" })
    expect(result).toContain("required")
  })

  test("should reject path traversal in read_file", async () => {
    const result = await executeReadFile({ path: "/tmp/../etc/passwd" })
    expect(result).toContain("安全限制")
  })

  test("should reject path traversal in grep_search", async () => {
    const result = await executeGrepSearch({ pattern: "test", path: "/tmp/../etc" })
    expect(result).toContain("安全限制")
  })

  test("should require pattern for grep_search", async () => {
    const result = await executeGrepSearch({ pattern: "", path: tempDir })
    expect(result).toContain("required")
  })

  test("should handle no matches in grep_search", async () => {
    writeFileSync(join(tempDir, "nomatch.txt"), "foo bar baz\n")

    const result = await executeGrepSearch({
      pattern: "zzzzzz-no-match-pattern",
      path: tempDir,
      include: "*.txt",
    })
    expect(result).toContain("No matches found")
  })

  test("should respect max_results in grep_search", async () => {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(tempDir, `multi-${i}.txt`), `match-line-here-${i}\nother\n`)
    }

    const result = await executeGrepSearch({
      pattern: "match-line-here",
      path: tempDir,
      include: "*.txt",
      max_results: 2,
    })
    const lines = result.split("\n").filter(l => l.trim().length > 0)
    expect(lines.length).toBeLessThanOrEqual(2)
  })

  test("should handle empty directory in grep_search", async () => {
    const emptyDir = join(tempDir, "empty")
    mkdirSync(emptyDir)

    const result = await executeGrepSearch({
      pattern: "anything",
      path: emptyDir,
    })
    expect(result).toContain("No matches found")
  })

  test("should read file via executeTool dispatch", async () => {
    const filePath = join(tempDir, "dispatch-read.txt")
    writeFileSync(filePath, "dispatch-content\n")

    const result = await executeTool("read_file", { path: filePath })
    expect(result).toContain("dispatch-content")
  })

  test("should grep via executeTool dispatch", async () => {
    writeFileSync(join(tempDir, "dispatch-grep.txt"), "findme-content\n")

    const result = await executeTool("grep_search", {
      pattern: "findme",
      path: tempDir,
      include: "*.txt",
    })
    expect(result).toContain("findme")
  })
})
