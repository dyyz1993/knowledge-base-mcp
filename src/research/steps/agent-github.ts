import type { SearchResult } from "../../search/types"
import type { GitHubCheck, DeepReadItem } from "../types"
import { checkGithub, fetchGitHubFile } from "./check-github"

export interface GithubState {
  query: string
  githubHints: string[]
  collectedSearchResults: SearchResult[]
  deepReadResults: DeepReadItem[]
  phaseLog: string[]
}

export function extractGithubUrls(results: SearchResult[]): string[] {
  const urls: string[] = []
  const pattern = /github\.com\/([^/]+\/[^/]+)/
  for (const r of results) {
    const m = r.url.match(pattern)
    if (m) {
      const repo = `https://github.com/${m[1]}`
      if (!urls.includes(repo)) urls.push(repo)
    }
  }
  return urls.slice(0, 3)
}

export async function executeCheckGithub(state: GithubState): Promise<GitHubCheck> {
  const hints = state.githubHints.length > 0
    ? state.githubHints
    : extractGithubUrls(state.collectedSearchResults)

  if (hints.length === 0) {
    state.phaseLog.push("github: no repo candidates found")
    return { repoUrl: null, needsClone: false, targetPaths: [], searchKeywords: [] }
  }

  const githubResult = await checkGithub(hints, state.collectedSearchResults, state.query)

  if (!githubResult.repoUrl) {
    state.phaseLog.push("github: no valid repo identified")
    return githubResult
  }

  const paths = githubResult.targetPaths.slice(0, 10)
  state.phaseLog.push(`github: found ${githubResult.repoUrl}, reading ${paths.length} files: ${paths.join(", ")}`)

  const results: DeepReadItem[] = []
  for (const p of paths) {
    try {
      const content = await fetchGitHubFile(githubResult.repoUrl, p)
      if (content && content.length > 50) {
        const rawUrl = githubResult.repoUrl
          .replace("github.com", "raw.githubusercontent.com")
        results.push({
          title: `${githubResult.repoUrl}/${p}`,
          url: `${rawUrl}/HEAD/${p}`,
          content: content.slice(0, 15000),
          success: true,
          source: "github",
        })
      }
    } catch (e) {
      state.phaseLog.push(`github: failed to fetch ${p}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const successful = results.filter(r => r.success)
  const existingUrls = new Set(state.deepReadResults.map(r => r.url))
  const newResults = successful.filter(r => !existingUrls.has(r.url))
  state.deepReadResults.push(...newResults)
  state.phaseLog.push(`github: ${newResults.length}/${paths.length} files read (${successful.length - newResults.length} deduped)`)

  return githubResult
}
