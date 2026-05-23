import { test, expect, describe, beforeEach, afterEach, spyOn } from "bun:test"

describe("Logger", () => {
  let stdoutSpy: ReturnType<typeof spyOn>
  let stderrSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    delete process.env.LOG_LEVEL
    delete process.env.LOG_FORMAT
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true)
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
  })

  afterEach(() => {
    stdoutSpy.mockRestore()
    stderrSpy.mockRestore()
    delete process.env.LOG_LEVEL
    delete process.env.LOG_FORMAT
  })

  describe("log level filtering", () => {
    test("should log info by default", async () => {
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.info("hello")

      expect(stdoutSpy).toHaveBeenCalled()
      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain("hello")
      expect(output).toContain("[INFO]")
    })

    test("should log error by default", async () => {
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.error("error msg")

      expect(stderrSpy).toHaveBeenCalled()
      const output = stderrSpy.mock.calls[0][0] as string
      expect(output).toContain("error msg")
      expect(output).toContain("[ERROR]")
    })

    test("should log warn by default", async () => {
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.warn("warning msg")

      expect(stderrSpy).toHaveBeenCalled()
      const output = stderrSpy.mock.calls[0][0] as string
      expect(output).toContain("warning msg")
      expect(output).toContain("[WARN]")
    })

    test("should not log debug when level is info", async () => {
      process.env.LOG_LEVEL = "info"
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.debug("debug msg")

      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
    })

    test("should log debug when level is debug", async () => {
      process.env.LOG_LEVEL = "debug"
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.debug("debug msg")

      expect(stdoutSpy).toHaveBeenCalled()
      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain("debug msg")
      expect(output).toContain("[DEBUG]")
    })

    test("should not log info when level is warn", async () => {
      process.env.LOG_LEVEL = "warn"
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.info("should not appear")

      expect(stdoutSpy).not.toHaveBeenCalled()
    })

    test("should not log info or warn when level is error", async () => {
      process.env.LOG_LEVEL = "error"
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.info("info msg")
      logger.warn("warn msg")

      expect(stdoutSpy).not.toHaveBeenCalled()
      expect(stderrSpy).not.toHaveBeenCalled()
    })
  })

  describe("log format", () => {
    test("should output JSON format when LOG_FORMAT=json", async () => {
      process.env.LOG_FORMAT = "json"
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.info("json test")

      expect(stdoutSpy).toHaveBeenCalled()
      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output.trim())
      expect(parsed.level).toBe("info")
      expect(parsed.message).toBe("json test")
      expect(parsed.context).toBe("test")
      expect(parsed.timestamp).toBeTruthy()
    })

    test("should output JSON format with data", async () => {
      process.env.LOG_FORMAT = "json"
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.info("with data", { key: "value" })

      const output = stdoutSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output.trim())
      expect(parsed.data).toEqual({ key: "value" })
    })

    test("should write errors to stderr in JSON mode", async () => {
      process.env.LOG_FORMAT = "json"
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.error("err")

      expect(stderrSpy).toHaveBeenCalled()
      const output = stderrSpy.mock.calls[0][0] as string
      const parsed = JSON.parse(output.trim())
      expect(parsed.level).toBe("error")
    })

    test("should output pretty format by default", async () => {
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.info("pretty test")

      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain("[INFO]")
      expect(output).not.toMatch(/^\{/)
    })

    test("should include context in pretty output", async () => {
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("my-module")

      logger.info("ctx test")

      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain("my-module")
    })

    test("should include data in pretty output for objects", async () => {
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.info("data test", { count: 42 })

      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain('"count":42')
    })

    test("should include string data in pretty output", async () => {
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("test")

      logger.info("string data", "extra info")

      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain("extra info")
    })
  })

  describe("createLogger factory", () => {
    test("should create logger with context", async () => {
      const { createLogger } = await import("../src/utils/logger")
      const logger = createLogger("my-context")

      logger.info("test")

      const output = stdoutSpy.mock.calls[0][0] as string
      expect(output).toContain("my-context")
    })
  })
})
