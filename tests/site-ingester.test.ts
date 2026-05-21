import { describe, test, expect, mock, beforeEach } from "bun:test"
import { ingestSite } from "../src/ingest/site-ingester"

const mockWriteDoc = mock(() => ({ id: "test-doc-id" }))

function makeSitemapXml(urls: string[]): string {
  const entries = urls.map(u => `  <url><loc>${u}</loc></url>`).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`
}

function makeVitePressHtml(sidebarJson: object): string {
  const escaped = JSON.stringify(sidebarJson).replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return `<html><head><script>window.__VP_SITE_DATA__ = JSON.parse("${escaped}")</script></head><body><div id="app">content here that is long enough to pass the fifty character threshold for document storage</div></body></html>`
}

function makeHtmlPage(body: string): string {
  return `<html><body><main>${body}</main></body></html>`
}

beforeEach(() => {
  mockWriteDoc.mockClear()
})

describe("pathToSection (via ingestSite results)", () => {
  test("3-segment path maps section/sub to title-cased", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/api/routing"])
    const pageHtml = makeHtmlPage("<h1>Routing</h1><p>This is the routing documentation page with enough content to be stored properly in the knowledge base system.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs", maxPages: 10 }, undefined, mockWriteDoc, mockFetchText)
    expect(result.totalPages).toBe(1)
    expect(result.documents[0].section).toBe("Api Routing")
  })

  test("2-segment path maps single part to title case", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/introduction"])
    const pageHtml = makeHtmlPage("<h1>Intro</h1><p>Introduction page content that is sufficiently long to pass the minimum content threshold for document ingestion pipeline.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.documents[0].section).toBe("Introduction")
  })

  test("single-segment path returns General", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/"])
    const pageHtml = makeHtmlPage("<h1>Home</h1><p>Homepage content that is long enough to be accepted by the document storage system without being rejected for insufficient length.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.documents[0].section).toBe("General")
  })

  test("path with hyphens converts to spaces and title cases", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/getting-started/bun-setup"])
    const pageHtml = makeHtmlPage("<h1>Setup</h1><p>Getting started with bun setup content that is definitely long enough to meet the minimum storage threshold requirement.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.documents[0].section).toBe("Getting Started Bun Setup")
  })
})

describe("pathToTitle (via ingestSite results)", () => {
  test("last segment becomes title", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/api/routing"])
    const pageHtml = makeHtmlPage("<h1>Routing</h1><p>Content that is long enough to pass the minimum fifty character threshold for document storage in knowledge base.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.documents[0].title).toBe("Routing")
  })

  test("root path becomes Index", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/"])
    const pageHtml = makeHtmlPage("<p>Homepage content that is definitely long enough to pass through the minimum content threshold for knowledge base document storage.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.documents[0].title).toBe("Index")
  })
})

describe("htmlToMarkdown (via page content)", () => {
  test("converts headings", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/test"])
    const pageHtml = makeHtmlPage("<h1>Title</h1><h2>Sub</h2><h3>Deep</h3><p>Enough content to pass the fifty character minimum threshold for document storage in knowledge base system.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    const content = mockWriteDoc.mock.calls[0]?.[1] as string | undefined
    expect(content).toContain("# Title")
    expect(content).toContain("## Sub")
    expect(content).toContain("### Deep")
  })

  test("converts code blocks with language", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/code"])
    const pageHtml = makeHtmlPage(`<pre><code class="language-typescript">const x: number = 1</code></pre><p>Additional paragraph content to ensure this page has enough text to pass the minimum document storage threshold.</p>`)

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    const content = mockWriteDoc.mock.calls[0]?.[1] as string | undefined
    expect(content).toContain("```typescript")
    expect(content).toContain("const x: number = 1")
  })

  test("converts links", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/links"])
    const pageHtml = makeHtmlPage('<p>Check <a href="/docs/other">the guide</a> for more. Plus enough additional content padding to meet the minimum length threshold for storage.</p>')

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    const content = mockWriteDoc.mock.calls[0]?.[1] as string | undefined
    expect(content).toContain("[the guide](/docs/other)")
  })

  test("converts bold and italic", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/format"])
    const pageHtml = makeHtmlPage("<p>This is <strong>bold</strong> and <em>italic</em> text. Additional content padding here to ensure this page exceeds the minimum storage threshold.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    const content = mockWriteDoc.mock.calls[0]?.[1] as string | undefined
    expect(content).toContain("**bold**")
    expect(content).toContain("*italic*")
  })

  test("strips script/style/nav/header/footer tags", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/clean"])
    const pageHtml = `<html><body><main><script>alert('xss')</script><style>.x{color:red}</style><nav>Navigation</nav><header>Header</header><footer>Footer</footer><p>Real content that should remain after stripping all the noise elements from the HTML document.</p></main></body></html>`

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    const content = mockWriteDoc.mock.calls[0]?.[1] as string | undefined
    expect(content).not.toContain("alert")
    expect(content).not.toContain("color:red")
    expect(content).not.toContain("Navigation")
    expect(content).not.toContain("Header")
    expect(content).not.toContain("Footer")
    expect(content).toContain("Real content")
  })

  test("decodes HTML entities", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/entities"])
    const pageHtml = makeHtmlPage("<p>Use &amp; for and, &lt; for less, &gt; for greater, &quot; for quote. Plus more padding text to reach the minimum.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    const content = mockWriteDoc.mock.calls[0]?.[1] as string | undefined
    expect(content).toContain("&")
    expect(content).toContain("<")
    expect(content).toContain(">")
  })
})

describe("Discovery: sitemap.xml", () => {
  test("discovers pages from sitemap.xml", async () => {
    const sitemapXml = makeSitemapXml([
      "https://example.com/docs/getting-started",
      "https://example.com/docs/api/routing",
      "https://example.com/docs/guides/middleware",
    ])
    const pageHtml = makeHtmlPage("<p>Content long enough to be stored as a proper document in the knowledge base system without any issues or rejections from storage layer.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("sitemap.xml")
    expect(result.totalPages).toBe(3)
    expect(result.successPages).toBe(3)
  })

  test("returns null when sitemap has no matching URLs", async () => {
    const sitemapXml = makeSitemapXml(["https://other.com/other/page"])

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      if (callIdx === 4) return Promise.resolve("")
      if (callIdx === 5) return Promise.resolve(makeHtmlPage('<a href="/docs/page">Page</a><p>Content padding to ensure the page is stored in the knowledge base document storage system properly.</p>'))
      return Promise.resolve(makeHtmlPage("<p>Enough content for knowledge base document storage system to accept without threshold rejections.</p>"))
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("link-discovery")
  })

  test("empty sitemap XML falls through to next strategy", async () => {
    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve("")
      if (callIdx === 4) return Promise.resolve("")
      return Promise.resolve(makeHtmlPage('<a href="/docs/page">Page</a><p>Content padding to ensure the page is stored in the knowledge base document storage system properly.</p>'))
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("link-discovery")
  })
})

describe("Discovery: sitemap index", () => {
  test("follows sitemap-index.xml sub-sitemaps", async () => {
    const sitemapIndex = `<?xml version="1.0"?>
<sitemapindex>
  <sitemap><loc>https://example.com/sitemap-docs.xml</loc></sitemap>
</sitemapindex>`
    const subSitemap = makeSitemapXml(["https://example.com/docs/guide-one"])
    const pageHtml = makeHtmlPage("<p>Page content that is long enough to be stored in the knowledge base system without any rejection from the storage layer.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapIndex)
      if (callIdx === 4) return Promise.resolve(subSitemap)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("sitemap.xml")
    expect(result.totalPages).toBe(1)
    expect(result.successPages).toBe(1)
  })
})

describe("Discovery: robots.txt Sitemap directive", () => {
  test("finds sitemap URL from robots.txt", async () => {
    const robotsTxt = `User-agent: *\nDisallow: /admin\n\nSitemap: https://example.com/custom-sitemap.xml`
    const sitemapXml = makeSitemapXml(["https://example.com/docs/from-robots"])
    const pageHtml = makeHtmlPage("<p>Content found via robots.txt sitemap directive, long enough for document storage in knowledge base system without any issues.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve("")
      if (callIdx === 4) return Promise.resolve("")
      if (callIdx === 5) return Promise.resolve(robotsTxt)
      if (callIdx === 6) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("sitemap.xml")
    expect(result.totalPages).toBe(1)
  })
})

describe("Discovery: VitePress __VP_SITE_DATA__", () => {
  test("extracts pages from VitePress sidebar", async () => {
    const sidebarData = {
      themeConfig: {
        sidebar: {
          "/docs/": [
            { text: "Getting Started", link: "/docs/getting-started" },
            {
              text: "API",
              items: [
                { text: "Routing", link: "/docs/api/routing" },
                { text: "Middleware", link: "/docs/api/middleware" },
              ],
            },
          ],
        },
      },
    }
    const vpHtml = makeVitePressHtml(sidebarData)
    const pageHtml = makeHtmlPage("<p>This is a VitePress page with enough content to be stored in the knowledge base system without being rejected for insufficient content length.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve("")
      if (callIdx === 4) return Promise.resolve("")
      if (callIdx === 5) return Promise.resolve("")
      if (callIdx === 6) return Promise.resolve(vpHtml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("vitepress-sidebar")
    expect(result.totalPages).toBe(3)
  })

  test("returns null when VP sidebar has no items", async () => {
    const sidebarData = { themeConfig: { sidebar: { "/docs/": [] } } }
    const vpHtml = makeVitePressHtml(sidebarData)

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx <= 5) return Promise.resolve("")
      if (callIdx === 6) return Promise.resolve(vpHtml)
      if (callIdx === 7) return Promise.resolve(makeHtmlPage('<a href="/docs/page">Link</a><p>Content that is long enough to pass the threshold for the document storage in knowledge base system.</p>'))
      return Promise.resolve(makeHtmlPage("<p>Content that is long enough to be accepted in the knowledge base document storage system.</p>"))
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("link-discovery")
  })
})

describe("Discovery: link discovery fallback", () => {
  test("extracts links from homepage HTML", async () => {
    const homepageHtml = `<html><body>
      <a href="/docs/intro">Intro</a>
      <a href="/docs/guide">Guide</a>
      <a href="/docs/api">API</a>
      <a href="https://external.com/page">External</a>
      <a href="/images/logo.png">Image</a>
      <p>Page content padding to meet the minimum threshold for knowledge base document storage requirements.</p>
    </body></html>`

    const pageHtml = makeHtmlPage("<p>Individual page content long enough to be stored in knowledge base system without rejection from document storage layer.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx <= 7) return Promise.resolve(homepageHtml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("link-discovery")
    expect(result.totalPages).toBe(3) // intro, guide, api (external and png skipped)
  })

  test("skips asset file links", async () => {
    const homepageHtml = `<html><body>
      <a href="/docs/page">Page</a>
      <a href="/style.css">CSS</a>
      <a href="/app.js">JS</a>
      <a href="/logo.svg">SVG</a>
      <p>Content for link discovery page that is sufficiently long for knowledge base document storage.</p>
    </body></html>`

    const pageHtml = makeHtmlPage("<p>Page content long enough to be stored in knowledge base system.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx <= 7) return Promise.resolve(homepageHtml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.totalPages).toBe(1)
  })
})

describe("Deduplication", () => {
  test("duplicate paths are filtered to single entry", async () => {
    const sitemapXml = makeSitemapXml([
      "https://example.com/docs/api/routing",
      "https://example.com/docs/api/routing",
      "https://example.com/docs/api/routing",
    ])
    const pageHtml = makeHtmlPage("<p>Content that is long enough to pass the storage threshold for knowledge base document ingestion and storage pipeline.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.totalPages).toBe(1)
  })
})

describe("maxPages limiting", () => {
  test("respects maxPages option", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://example.com/docs/page-${i}`)
    const sitemapXml = makeSitemapXml(urls)
    const pageHtml = makeHtmlPage("<p>Page content that is long enough for document storage in knowledge base system without any rejection.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs", maxPages: 3 }, undefined, mockWriteDoc, mockFetchText)
    expect(result.totalPages).toBe(3)
  })
})

describe("Invalid URL handling", () => {
  test("invalid URL throws because URL parsing fails before strategies", async () => {
    await expect(ingestSite({ url: "not-a-url" }, undefined, mockWriteDoc)).rejects.toThrow()
  })
})

describe("Progress callback", () => {
  test("receives phase events", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/page"])
    const pageHtml = makeHtmlPage("<p>Content long enough for document storage in knowledge base system to properly accept and store without rejection.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const events: string[] = []
    const result = await ingestSite(
      { url: "https://example.com/docs" },
      (e) => { events.push(e.phase) },
      mockWriteDoc,
      mockFetchText,
    )

    expect(events).toContain("discovering")
    expect(events).toContain("fetching")
    expect(events).toContain("storing")
    expect(events).toContain("done")
    expect(result.successPages).toBe(1)
  })
})

describe("Content extraction fallback", () => {
  test("falls back to full HTML when no main/article/content div", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/raw"])
    const rawHtml = "<html><body><h1>Raw Page</h1><p>Raw HTML page with enough content to pass the fifty character minimum threshold for document storage in knowledge base.</p></body></html>"

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(rawHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.successPages).toBe(1)
    const content = mockWriteDoc.mock.calls[0]?.[1] as string | undefined
    expect(content).toContain("Raw Page")
  })

  test("extracts from article tag", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/article"])
    const articleHtml = "<html><body><article><h1>Article</h1><p>Article content that is sufficiently long to pass the minimum threshold for knowledge base document storage.</p></article></body></html>"

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(articleHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.successPages).toBe(1)
    const content = mockWriteDoc.mock.calls[0]?.[1] as string | undefined
    expect(content).toContain("# Article")
  })

  test("pages with content < 50 chars are skipped", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/short"])
    const shortHtml = makeHtmlPage("<p>Short</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(shortHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.successPages).toBe(0)
    expect(result.failedPages).toBe(1)
  })
})

describe("IngestResult structure", () => {
  test("returns correct result shape", async () => {
    const sitemapXml = makeSitemapXml(["https://example.com/docs/a"])
    const pageHtml = makeHtmlPage("<p>Page content that is long enough to be stored in the knowledge base system without being rejected by the storage layer.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    const result = await ingestSite({ url: "https://example.com/docs", tags: ["custom-tag"], projectName: "my-project" }, undefined, mockWriteDoc, mockFetchText)

    expect(result).toHaveProperty("totalPages", 1)
    expect(result).toHaveProperty("successPages", 1)
    expect(result).toHaveProperty("failedPages", 0)
    expect(result).toHaveProperty("strategy", "sitemap.xml")
    expect(result).toHaveProperty("durationMs")
    expect(typeof result.durationMs).toBe("number")
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0]).toHaveProperty("id")
    expect(result.documents[0]).toHaveProperty("title")
    expect(result.documents[0]).toHaveProperty("section")

    const writeCallMeta = mockWriteDoc.mock.calls[0]?.[0]
    expect(writeCallMeta.tags).toContain("custom-tag")
    expect(writeCallMeta.tags).toContain("reference")
    expect(writeCallMeta.tags).toContain("site-ingested")
    expect(writeCallMeta.source_project).toBe("my-project")
  })
})

describe("Domain extraction", () => {
  test("www prefix is stripped from domain", async () => {
    const sitemapXml = makeSitemapXml(["https://www.example.com/docs/test"])
    const pageHtml = makeHtmlPage("<p>Content that is long enough for document storage in knowledge base system to accept without any threshold issues.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    await ingestSite({ url: "https://www.example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    const writeCallMeta = mockWriteDoc.mock.calls[0]?.[0]
    expect(writeCallMeta.title).toContain("example.com")
    expect(writeCallMeta.title).not.toContain("www.")
  })
})

describe("Wiki index document generation", () => {
  test("creates outline doc with section grouping", async () => {
    const sitemapXml = makeSitemapXml([
      "https://example.com/docs/api/routing",
      "https://example.com/docs/guides/rpc",
    ])
    const pageHtml = makeHtmlPage("<p>Page content long enough for knowledge base storage system to accept the document without any threshold issues whatsoever.</p>")

    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx === 1) return Promise.resolve("")
      if (callIdx === 2) return Promise.resolve("")
      if (callIdx === 3) return Promise.resolve(sitemapXml)
      return Promise.resolve(pageHtml)
    }

    await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)

    const lastCall = mockWriteDoc.mock.calls[mockWriteDoc.mock.calls.length - 1]
    const content = lastCall?.[1] as string
    expect(content).toContain("Documentation Index")
    expect(content).toContain("Api Routing")
    expect(content).toContain("Guides Rpc")
    expect(content).toContain("id:test-doc-id")
  })
})

describe("No pages discovered", () => {
  test("returns empty result when all strategies fail", async () => {
    const mockFetchText = (_url: string) => Promise.resolve("")

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.totalPages).toBe(0)
    expect(result.successPages).toBe(0)
    expect(result.documents).toHaveLength(0)
    expect(result.strategy).toBe("none")
  })
})

describe("HTTP error handling", () => {
  test("non-200 responses are treated as missing", async () => {
    let callIdx = 0
    const mockFetchText = (_url: string) => {
      callIdx++
      if (callIdx <= 2) return Promise.resolve(null as unknown as string)
      if (callIdx === 3) return Promise.resolve(null as unknown as string)
      if (callIdx === 4) return Promise.resolve(null as unknown as string)
      return Promise.resolve(makeHtmlPage('<a href="/docs/x">X</a><p>Long enough content for knowledge base document storage system to accept without threshold rejection issues.</p>'))
    }

    const result = await ingestSite({ url: "https://example.com/docs" }, undefined, mockWriteDoc, mockFetchText)
    expect(result.strategy).toBe("link-discovery")
  })
})
