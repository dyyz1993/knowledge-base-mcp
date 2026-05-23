import { BASE } from "./client"
import type {
  AskResult,
  IngestResult,
  WebReadResult,
  PipelineSearchResponse,
  PipelineSearchResult,
  DeepReadResult,
  WorkKeyResult,
  ResearchResult,
  SummarizeResult,
  ResearchMode,
  AgentResearchProgress,
  AgentResearchResult,
} from "./types"

export async function smartAsk(query: string, signal?: AbortSignal): Promise<AskResult> {
  const res = await fetch(`${BASE}/api/kb-ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  })
  return res.json()
}

export async function ingestWebContent(params: {
  url: string
  title: string
  content: string
  tags?: string[]
  keywords?: string[]
}): Promise<IngestResult> {
  const res = await fetch(`${BASE}/api/kb-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  return res.json()
}

export async function webRead(url: string): Promise<WebReadResult> {
  const res = await fetch(`${BASE}/api/web-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  return res.json()
}

export async function askSearch(query: string, model?: { provider: string; id: string }, signal?: AbortSignal): Promise<PipelineSearchResponse> {
  const res = await fetch(`${BASE}/api/ask-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, model }),
    signal,
  })
  return res.json()
}

export async function askDeepRead(url: string): Promise<DeepReadResult> {
  const res = await fetch(`${BASE}/api/ask-deep-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  return res.json()
}

export async function askWorkKey(query: string, results: PipelineSearchResult[], model?: { provider: string; id: string }): Promise<WorkKeyResult> {
  const res = await fetch(`${BASE}/api/ask-work-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, results, model }),
  })
  return res.json()
}

export async function askResearch(query: string, model?: { provider: string; id: string }, signal?: AbortSignal): Promise<ResearchResult> {
  const res = await fetch(`${BASE}/api/ask-research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, model }),
    signal,
  })
  return res.json()
}

export function agentResearch(
  query: string,
  mode: ResearchMode,
  model?: { provider: string; id: string },
  smallModel?: { provider: string; id: string },
  onProgress?: (progress: AgentResearchProgress) => void,
  signal?: AbortSignal,
): Promise<AgentResearchResult> {
  return new Promise((resolve, reject) => {
    fetch(`${BASE}/api/agent-research`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, mode, model, smallModel }),
      signal,
    }).then((res) => {
      if (!res.ok) {
        reject(new Error(`HTTP ${res.status}`))
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        reject(new Error("No response body"))
        return
      }

      const decoder = new TextDecoder()
      let buffer = ""

      let resolved = false

      const processChunk = (chunk: string) => {
        buffer += chunk
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        let currentEvent = ""
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith("data: ") && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6))
              if (currentEvent === "step" && onProgress) {
                onProgress(data as AgentResearchProgress)
              } else if (currentEvent === "done") {
                resolved = true
                resolve(data as AgentResearchResult)
              } else if (currentEvent === "error") {
                resolved = true
                reject(new Error(data.error || "Unknown error"))
              }
            } catch (e) { console.warn('[ask] parse event data failed:', e) }
            currentEvent = ""
          }
        }
      }

      const read = (): Promise<void> => {
        return reader!.read().then(({ done, value }) => {
          if (done) {
            if (!resolved) {
              resolved = true
              reject(new Error("Stream ended without completion"))
            }
            return
          }
          processChunk(decoder.decode(value, { stream: true }))
          return read()
        })
      }

      read()
    }).catch(reject)
  })
}

export async function askSummarize(params: {
  query: string
  title: string
  content: string
  url?: string
  tags?: string[]
  keywords?: string[]
}): Promise<SummarizeResult> {
  const res = await fetch(`${BASE}/api/ask-summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
  return res.json()
}
