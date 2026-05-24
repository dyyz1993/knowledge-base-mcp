import { test, expect, describe, beforeEach, afterEach, beforeAll } from "bun:test"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs"

const TEST_DIR = join(tmpdir(), `kb-config-test-${Date.now()}`)

const { loadConfig, saveConfig, clearConfigCache } = await import("../src/config")

const CONFIG_PATH = join(TEST_DIR, "config.json")

beforeAll(() => {
  process.env.KB_DATA_DIR = TEST_DIR
  process.env.KB_DIR = TEST_DIR
})

describe("config", () => {
  beforeEach(() => {
    clearConfigCache()
  })

  afterEach(() => {
    clearConfigCache()
    if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH)
  })

  describe("DEFAULT_CONFIG values", () => {
    test("should have correct default embedding config", () => {
      const config = loadConfig()

      expect(config.embedding.provider).toBe("siliconflow")
      expect(config.embedding.baseUrl).toBe("https://api.siliconflow.cn/v1")
      expect(config.embedding.apiKey).toBe("")
      expect(config.embedding.model).toBe("Pro/BAAI/bge-m3")
      expect(config.embedding.dimensions).toBe(1024)
      expect(typeof config.embedding.enabled).toBe("boolean")
    })

    test("should have correct default search config", () => {
      const config = loadConfig()

      expect(config.search.mode).toBe("combined")
      expect(config.search.minScore).toBe(5.0)
      expect(config.search.combinedMinScore).toBe(0.05)
      expect(config.search.weights.token).toBe(0.2)
      expect(config.search.weights.tfidf).toBe(0.25)
      expect(config.search.weights.semantic).toBe(0.45)
      expect(config.search.weights.fuzzy).toBe(0.1)
    })

    test("should have correct default skills config", () => {
      const config = loadConfig()

      expect(config.skills.autoScan).toBe(false)
      expect(config.skills.paths.length).toBeGreaterThan(0)
    })

    test("should have correct default browser config", () => {
      const config = loadConfig()

      expect(config.browser.headless).toBe(true)
      expect(config.browser.defaultTimeout).toBe(15000)
      expect(config.browser.cdpEndpoint).toBe("")
    })

    test("should have correct default webSearch config", () => {
      const config = loadConfig()

      expect(config.webSearch.enabled).toBe(true)
      expect(config.webSearch.apiKey).toBe("")
      expect(config.webSearch.tavilyApiKey).toBe("")
      expect(config.webSearch.serperApiKey).toBe("")
    })

    test("should have correct default searchPipeline config", () => {
      const config = loadConfig()

      expect(config.searchPipeline.enabled).toBe(true)
      expect(config.searchPipeline.maxResults).toBe(10)
      expect(config.searchPipeline.sources.webSearchPrime.enabled).toBe(true)
      expect(config.searchPipeline.sources.xbrowser.enabled).toBe(false)
      expect(config.searchPipeline.sources.xbrowser.engine).toBe("google")
      expect(config.searchPipeline.sources.tavily.enabled).toBe(true)
      expect(config.searchPipeline.sources.serper.enabled).toBe(true)
      expect(config.searchPipeline.sources.aiSearch.enabled).toBe(true)
    })

    test("should have correct default storage config", () => {
      const config = loadConfig()

      expect(config.storage.cacheTtlMs).toBe(5000)
    })

    test("should have correct default timeouts config", () => {
      const config = loadConfig()

      expect(config.timeouts.webReadMs).toBe(15000)
      expect(config.timeouts.deepReadMs).toBe(10000)
    })

    test("should have correct default askPipeline config", () => {
      const config = loadConfig()

      expect(config.askPipeline.maxLoops).toBe(2)
      expect(config.askPipeline.highScoreThreshold).toBe(45)
      expect(config.askPipeline.lowScoreThreshold).toBe(20)
    })
  })

  describe("loadConfig from file", () => {
    test("should merge partial config with defaults", () => {
      const partialConfig = {
        embedding: { apiKey: "test-key-123" },
        search: { minScore: 10.0 },
      }

      clearConfigCache()
      if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
      writeFileSync(CONFIG_PATH, JSON.stringify(partialConfig), "utf-8")

      const config = loadConfig()

      expect(config.embedding.apiKey).toBe("test-key-123")
      expect(config.embedding.provider).toBe("siliconflow")
      expect(config.search.minScore).toBe(10.0)
      expect(config.search.mode).toBe("combined")
      expect(config.search.combinedMinScore).toBe(0.05)
    })

    test("should handle corrupt config file gracefully", () => {
      clearConfigCache()
      if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
      writeFileSync(CONFIG_PATH, "not valid json{{{", "utf-8")

      const config = loadConfig()

      expect(config.embedding.provider).toBe("siliconflow")
      expect(config.search.mode).toBe("combined")
    })

    test("should expand ~/ in skill paths", () => {
      const config = loadConfig()

      for (const p of config.skills.paths) {
        expect(p.startsWith("~/")).toBe(false)
        expect(p.startsWith("/")).toBe(true)
      }
    })

    test("should override nested searchPipeline sources", () => {
      const override = {
        searchPipeline: {
          maxResults: 50,
          sources: {
            xbrowser: { enabled: true },
          },
        },
      }

      clearConfigCache()
      if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
      writeFileSync(CONFIG_PATH, JSON.stringify(override), "utf-8")

      const config = loadConfig()

      expect(config.searchPipeline.maxResults).toBe(50)
      expect(config.searchPipeline.sources.xbrowser.enabled).toBe(true)
      expect(config.searchPipeline.enabled).toBe(true)
    })
  })

  describe("saveConfig", () => {
    test("should save and reload config correctly", () => {
      const config = loadConfig()
      config.embedding.apiKey = "saved-key"
      config.search.minScore = 99.0
      saveConfig(config)

      const reloaded = loadConfig()
      expect(reloaded.embedding.apiKey).toBe("saved-key")
      expect(reloaded.search.minScore).toBe(99.0)
    })
  })

  describe("config without config file", () => {
    test("should return defaults when config file does not exist", () => {
      if (existsSync(CONFIG_PATH)) rmSync(CONFIG_PATH)

      const config = loadConfig()

      expect(config.embedding.provider).toBe("siliconflow")
      expect(config.embedding.dimensions).toBe(1024)
      expect(config.search.mode).toBe("combined")
    })
  })
})
