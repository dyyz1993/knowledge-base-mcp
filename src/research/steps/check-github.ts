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

  // Process up to 3 repos
  const allTargetPaths: string[] = []
  const allKeywords = query.toLowerCase().split(/[\s,，、]+/).filter(w => w.length > 1)
  let primaryRepoUrl = ""

  for (const repoUrl of repoUrls.slice(0, 3)) {
    const match = repoUrl.match(GITHUB_REPO_PATTERN)
    if (!match) continue
    const fullName = match[1]
    const apiBase = `https://api.github.com/repos/${fullName}`

    if (!primaryRepoUrl) primaryRepoUrl = repoUrl

    // Check README
    try {
      const resp = await fetch(`${apiBase}/readme`, {
        headers: {
          "User-Agent": "KB-MCP/1.0",
          "Accept": "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(8000),
      })
      if (resp.ok) {
        allTargetPaths.push(`${fullName}/README.md`)
      }
    } catch (e) {
      console.warn("[check-github]", e instanceof Error ? e.message : String(e))
    }

    // Check root directory for docs/examples
    try {
      const resp = await fetch(`${apiBase}/contents/`, {
        headers: {
          "User-Agent": "KB-MCP/1.0",
          "Accept": "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(8000),
      })
      if (resp.ok) {
        const entries = await resp.json() as Array<{ name: string; type: string; path: string }>
        const docDirs = entries.filter(e =>
          e.type === "dir" && /docs?|examples?|packages?\/core/i.test(e.name)
        )
        for (const d of docDirs) {
          allTargetPaths.push(`${fullName}/${d.path}`)
        }
        const docFiles = entries.filter(e =>
          e.type === "file" && /\.(md|mdx)$/i.test(e.name)
        )
        for (const f of docFiles) {
          allTargetPaths.push(`${fullName}/${f.path}`)
        }
      }
    } catch (e) {
      console.warn("[check-github]", e instanceof Error ? e.message : String(e))
    }

    // Check docs/ directory
    try {
      const resp = await fetch(`${apiBase}/contents/docs`, {
        headers: {
          "User-Agent": "KB-MCP/1.0",
          "Accept": "application/vnd.github.v3+json",
        },
        signal: AbortSignal.timeout(8000),
      })
      if (resp.ok) {
        const docs = await resp.json() as Array<{ name: string; type: string; path: string }>
        for (const d of docs) {
          if (d.type === "file" && /\.(md|mdx)$/i.test(d.name)) {
            allTargetPaths.push(`${fullName}/${d.path}`)
          }
        }
      }
    } catch (e) {
      console.warn("[check-github]", e instanceof Error ? e.message : String(e))
    }
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
