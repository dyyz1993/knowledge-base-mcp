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

  const repoUrl = repoUrls[0]
  const match = repoUrl.match(GITHUB_REPO_PATTERN)
  if (!match) {
    return { repoUrl: null, needsClone: false, targetPaths: [], searchKeywords: [] }
  }
  const fullName = match[1]

  const apiBase = `https://api.github.com/repos/${fullName}`

  const keywords = query.toLowerCase().split(/[\s,，、]+/).filter(w => w.length > 1)

  const targetPaths: string[] = []

  try {
    const resp = await fetch(`${apiBase}/readme`, {
      headers: {
        "User-Agent": "KB-MCP/1.0",
        "Accept": "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(10000),
    })
    if (resp.ok) {
      targetPaths.push("README.md")
    }
  } catch {}

  try {
    const resp = await fetch(`${apiBase}/contents/`, {
      headers: {
        "User-Agent": "KB-MCP/1.0",
        "Accept": "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(10000),
    })
    if (resp.ok) {
      const entries = await resp.json() as Array<{ name: string; type: string; path: string }>
      const docDirs = entries.filter(e =>
        e.type === "dir" && /docs?|examples?|packages?\/core/i.test(e.name)
      )
      for (const d of docDirs) {
        targetPaths.push(d.path)
      }
      const docFiles = entries.filter(e =>
        e.type === "file" && /\.(md|mdx)$/i.test(e.name)
      )
      for (const f of docFiles) {
        targetPaths.push(f.path)
      }
    }
  } catch {}

  try {
    const resp = await fetch(`${apiBase}/contents/docs`, {
      headers: {
        "User-Agent": "KB-MCP/1.0",
        "Accept": "application/vnd.github.v3+json",
      },
      signal: AbortSignal.timeout(10000),
    })
    if (resp.ok) {
      const docs = await resp.json() as Array<{ name: string; type: string; path: string }>
      for (const d of docs) {
        if (d.type === "file" && /\.(md|mdx)$/i.test(d.name)) {
          targetPaths.push(d.path)
        }
      }
    }
  } catch {}

  return {
    repoUrl,
    needsClone: targetPaths.length > 5,
    targetPaths: targetPaths.slice(0, 20),
    searchKeywords: keywords,
  }
}

export async function fetchGitHubFile(
  repoUrl: string,
  filePath: string,
): Promise<string> {
  const match = repoUrl.match(GITHUB_REPO_PATTERN)
  if (!match) return ""
  const fullName = match[1]
  const apiUrl = `https://api.github.com/repos/${fullName}/contents/${filePath}`

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
  } catch {}

  return ""
}
