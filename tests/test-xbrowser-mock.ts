import { describe, it, expect, mock, beforeAll } from "bun:test"

mock.module("../src/search/xbrowser-cli", () => ({
  XBrowserCLI: mock(function (this: any) {
    this.search = mock(() => Promise.resolve([
      { title: "XB test Result", url: "https://xb.com/1", snippet: "xb test snippet" },
    ]))
    this.aiSearch = mock(() => Promise.resolve({ results: [] }))
  }),
}))

mock.module("../src/search/utils", () => ({
  normalizeUrl: (url: string) => url.replace(/\/+$/, "").toLowerCase(),
}))

describe("xbrowser debug", () => {
  it("should use mock", async () => {
    const mod = await import("../src/search/source-xbrowser")
    const src = new mod.XBrowserEngineSource(
      { enabled: true, engine: "google", cdpEndpoint: "", headless: true, timeout: 10000 },
      "google",
    )
    const results = await src.search("test query words")
    console.log("DEBUG results:", results.length, results.map((r: any) => r.title))
    expect(results.length).toBe(1)
  })
})
