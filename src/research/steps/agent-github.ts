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

  const repoUrl = githubResult.repoUrl!
  const paths = githubResult.targetPaths.slice(0, 10)
  state.phaseLog.push(`github: found ${repoUrl}, reading ${paths.length} files: ${paths.join(", ")}`)

  const results: DeepReadItem[] = []
  const contents = await Promise.allSettled(
    paths.map(p => fetchGitHubFile(repoUrl, p).then(content => {
      if (content && content.length > 50) {
        const rawUrl = repoUrl
          .replace("github.com", "raw.githubusercontent.com")
        return {
          title: `${repoUrl}/${p}`,
          url: `${rawUrl}/HEAD/${p}`,
          content: content.slice(0, 15000),
          success: true,
          source: "github" as const,
        }
      }
      return null
    }).catch(() => null))
  )
  for (const r of contents) {
    if (r.status === "fulfilled" && r.value) {
      results.push(r.value)
    } else if (r.status === "rejected") {
      state.phaseLog.push(`github: failed to fetch: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    }
  }

  const successful = results.filter(r => r.success)
  const existingUrls = new Set(state.deepReadResults.map(r => r.url))
  const newResults = successful.filter(r => !existingUrls.has(r.url))
  state.deepReadResults.push(...newResults)
  state.phaseLog.push(`github: ${newResults.length}/${paths.length} files read (${successful.length - newResults.length} deduped)`)

  return githubResult
}
