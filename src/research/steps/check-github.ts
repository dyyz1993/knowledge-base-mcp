import type { GitHubCheck } from "../types"
import type { SearchResult } from "../../search/types"

const GITHUB_REPO_PATTERN = /github\.com\/([^/]+\/[^/]+)/

export async function checkGithub(
  hints: string[],
  searchResults: SearchResult[],
  query: string,
): Promise<GitHubCheck> {
  const repoUrls: string[] = []

  for (const h of hints) {
    const m = h.match(GITHUB_REPO_PATTERN)
    if (m) repoUrls.push(`https://github.com/${m[1]}`)
  }

  for (const r of searchResults) {
    const m = r.url.match(GITHUB_REPO_PATTERN)
    if (m) {
      const repo = `https://github.com/${m[1]}`
      if (!repoUrls.includes(repo)) repoUrls.push(repo)
    }
  }

  if (repoUrls.length === 0) {
    return { repoUrl: null, needsClone: false, targetPaths: [], searchKeywords: [] }
  }

  // Process up to 3 repos with parallel API calls per repo + rate-limit detection
  const allTargetPaths: string[] = []
  const allKeywords = query.toLowerCase().split(/[\s,，、]+/).filter(w => w.length > 1)
  let primaryRepoUrl = ""
  let rateLimited = false

  for (const repoUrl of repoUrls.slice(0, 3)) {
    if (rateLimited) break
    const match = repoUrl.match(GITHUB_REPO_PATTERN)
    if (!match) continue
    const fullName = match[1]
    const apiBase = `https://api.github.com/repos/${fullName}`

    if (!primaryRepoUrl) primaryRepoUrl = repoUrl

    // Make 3 API calls in parallel per repo
    const [readmeResult, rootResult, docsResult] = await Promise.allSettled([
      fetch(`${apiBase}/readme`, {
        headers: { "User-Agent": "KB-MCP/1.0", "Accept": "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(8000),
      }).then(async (resp) => {
        if (resp.status === 403) { rateLimited = true; return null }
        if (resp.ok) return `${fullName}/README.md`
        return null
      }).catch(() => null),

      fetch(`${apiBase}/contents/`, {
        headers: { "User-Agent": "KB-MCP/1.0", "Accept": "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(8000),
      }).then(async (resp) => {
        if (resp.status === 403) { rateLimited = true; return [] as string[] }
        if (!resp.ok) return [] as string[]
        const entries = await resp.json() as Array<{ name: string; type: string; path: string }>
        const paths: string[] = []
        const docDirs = entries.filter(e =>
          e.type === "dir" && /docs?|examples?|packages?\/core/i.test(e.name)
        )
        for (const d of docDirs) paths.push(`${fullName}/${d.path}`)
        const docFiles = entries.filter(e =>
          e.type === "file" && /\.(md|mdx)$/i.test(e.name)
        )
        for (const f of docFiles) paths.push(`${fullName}/${f.path}`)
        return paths
      }).catch(() => [] as string[]),

      fetch(`${apiBase}/contents/docs`, {
        headers: { "User-Agent": "KB-MCP/1.0", "Accept": "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(8000),
      }).then(async (resp) => {
        if (resp.status === 403) { rateLimited = true; return [] as string[] }
        if (!resp.ok) return [] as string[]
        const entries = await resp.json() as Array<{ name: string; type: string; path: string }>
        return entries
          .filter(e => e.type === "file" && /\.(md|mdx)$/i.test(e.name))
          .map(e => `${fullName}/docs/${e.path}`)
      }).catch(() => [] as string[]),
    ])

    if (readmeResult.status === "fulfilled" && readmeResult.value) {
      allTargetPaths.push(readmeResult.value)
    }
    if (rootResult.status === "fulfilled" && Array.isArray(rootResult.value)) {
      allTargetPaths.push(...rootResult.value)
    }
    if (docsResult.status === "fulfilled" && Array.isArray(docsResult.value)) {
      allTargetPaths.push(...docsResult.value)
    }
  }

  if (rateLimited) {
    console.warn("[check-github] GitHub API rate limit detected, results may be incomplete")
  }

  return {
    repoUrl: primaryRepoUrl || null,
    needsClone: allTargetPaths.length > 5,
    targetPaths: allTargetPaths.slice(0, 20),
    searchKeywords: allKeywords,
  }
}

export async function fetchGitHubFile(
  repoUrl: string,
  filePath: string,
): Promise<string> {
  // filePath may be "owner/repo/actual/path" or just "actual/path"
  let fullName: string
  let actualPath: string

  // If filePath starts with the repo prefix (e.g. "oven-sh/bun/README.md")
  const repoMatch = repoUrl.match(GITHUB_REPO_PATTERN)
  if (repoMatch && filePath.startsWith(repoMatch[1] + "/")) {
    fullName = repoMatch[1]
    actualPath = filePath.slice(fullName.length + 1)
  } else if (filePath.includes("/")) {
    // Try to parse as owner/repo/path
    const parts = filePath.split("/")
    if (parts.length >= 3) {
      fullName = `${parts[0]}/${parts[1]}`
      actualPath = parts.slice(2).join("/")
    } else {
      fullName = repoMatch ? repoMatch[1] : ""
      actualPath = filePath
    }
  } else {
    fullName = repoMatch ? repoMatch[1] : ""
    actualPath = filePath
  }

  if (!fullName) return ""
  const apiUrl = `https://api.github.com/repos/${fullName}/contents/${actualPath}`

  try {
    const resp = await fetch(apiUrl, {
      headers: {
        "User-Agent": "KB-MCP/1.0",
        "Accept": "application/vnd.github.v3.raw",
      },
      signal: AbortSignal.timeout(15000),
    })
    if (resp.ok) {
      return await resp.text()
    }
  } catch (e) {
    console.warn("[check-github]", e instanceof Error ? e.message : String(e))
  }

  return ""
}
