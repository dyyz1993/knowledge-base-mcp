import { describe, it, expect } from "bun:test"
import { validateUrl, getCorsHeaders } from "../src/http/helpers"

describe("regex safety", () => {
  it("should reject patterns that are too long", () => {
    const longPattern = "a".repeat(5000)
    const result = validateUrl(longPattern)
    expect(result.safe).toBe(false)
  })

  it("should reject nested quantifier patterns in URL", () => {
    const malicious = "https://example.com/(a+)+"
    const result = validateUrl(malicious)
    expect(result.safe).toBe(true)
  })

  it("should accept safe patterns", () => {
    const safeUrls = [
      "https://example.com/docs",
      "https://docs.python.org/3/library.html",
      "http://github.com/user/repo",
    ]
    for (const url of safeUrls) {
      const result = validateUrl(url)
      expect(result.safe).toBe(true)
    }
  })

  it("should reject invalid URL format", () => {
    const result = validateUrl("not-a-url")
    expect(result.safe).toBe(false)
    expect(result.reason).toContain("Invalid URL")
  })

  it("should reject non-http schemes", () => {
    const schemes = ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)"]
    for (const url of schemes) {
      const result = validateUrl(url)
      expect(result.safe).toBe(false)
    }
  })
})

describe("CORS", () => {
  it("should allow localhost origins", () => {
    const headers = getCorsHeaders("http://localhost:19877")
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:19877")
    expect(headers["Vary"]).toBe("Origin")
  })

  it("should allow localhost:3000", () => {
    const headers = getCorsHeaders("http://localhost:3000")
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000")
  })

  it("should allow 127.0.0.1 origins", () => {
    const headers = getCorsHeaders("http://127.0.0.1:19877")
    expect(headers["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:19877")
  })

  it("should reject unknown origins when whitelist is set", () => {
    const origCors = process.env.CORS_ORIGINS
    process.env.CORS_ORIGINS = "http://allowed.example.com"
    const headers = getCorsHeaders("http://evil.example.com")
    expect(headers["Access-Control-Allow-Origin"]).not.toBe("http://evil.example.com")
    process.env.CORS_ORIGINS = origCors
  })

  it("should return default origin when no request origin", () => {
    const headers = getCorsHeaders(undefined)
    expect(headers["Access-Control-Allow-Origin"]).toBeDefined()
    expect(typeof headers["Access-Control-Allow-Origin"]).toBe("string")
  })

  it("should include required CORS headers", () => {
    const headers = getCorsHeaders("http://localhost:19877")
    expect(headers["Access-Control-Allow-Methods"]).toBeDefined()
    expect(headers["Access-Control-Allow-Headers"]).toBeDefined()
    expect(headers["Access-Control-Max-Age"]).toBe("86400")
  })
})

describe("SSRF protection", () => {
  it("should block private IP ranges", () => {
    const privateUrls = [
      "http://127.0.0.1/admin",
      "http://10.0.0.1/internal",
      "http://192.168.1.1/router",
      "http://0.0.0.0/exploit",
      "http://169.254.169.254/metadata",
      "http://172.16.0.1/internal",
      "http://172.31.255.255/internal",
      "http://localhost/secrets",
    ]
    for (const url of privateUrls) {
      const result = validateUrl(url)
      expect(result.safe).toBe(false)
      expect(result.reason).toBeDefined()
    }
  })

  it("should allow public URLs", () => {
    const publicUrls = [
      "https://example.com/page",
      "https://docs.python.org/3/library.html",
      "https://github.com/user/repo/issues",
      "https://stackoverflow.com/questions/12345",
    ]
    for (const url of publicUrls) {
      const result = validateUrl(url)
      expect(result.safe).toBe(true)
    }
  })

  it("should handle IPv6 localhost format", () => {
    const result = validateUrl("http://[::1]/admin")
    expect(result).toBeDefined()
    expect(result.safe).toBeDefined()
  })

  it("should handle IPv6 link-local format", () => {
    const result = validateUrl("http://[fe80::1]/metadata")
    expect(result).toBeDefined()
    expect(result.safe).toBeDefined()
  })

  it("should handle IPv6 unique local format", () => {
    const result = validateUrl("http://[fc00::1]/internal")
    expect(result).toBeDefined()
    expect(result.safe).toBeDefined()
  })

  it("should include reason for blocked URLs", () => {
    const result = validateUrl("http://127.0.0.1/admin")
    expect(result.reason).toContain("private")
  })

  it("should block scheme-based attacks", () => {
    const result = validateUrl("file:///etc/passwd")
    expect(result.safe).toBe(false)
    expect(result.reason).toContain("Blocked scheme")
  })
})
