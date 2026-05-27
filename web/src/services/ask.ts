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

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function smartAsk(query: string, signal?: AbortSignal): Promise<AskResult> {
  return requestJson<AskResult>(`${BASE}/api/kb-ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  })
}

export async function ingestWebContent(params: {
  url: string
  title: string
  content: string
  tags?: string[]
  keywords?: string[]
}): Promise<IngestResult> {
  return requestJson<IngestResult>(`${BASE}/api/kb-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
}

export async function webRead(url: string): Promise<WebReadResult> {
  return requestJson<WebReadResult>(`${BASE}/api/web-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
}

export async function askSearch(query: string, model?: { provider: string; id: string }, signal?: AbortSignal): Promise<PipelineSearchResponse> {
  return requestJson<PipelineSearchResponse>(`${BASE}/api/ask-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, model }),
    signal,
  })
}

export async function askDeepRead(url: string): Promise<DeepReadResult> {
  return requestJson<DeepReadResult>(`${BASE}/api/ask-deep-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
}

export async function askWorkKey(query: string, results: PipelineSearchResult[], model?: { provider: string; id: string }): Promise<WorkKeyResult> {
  return requestJson<WorkKeyResult>(`${BASE}/api/ask-work-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, results, model }),
  })
}

export async function askResearch(query: string, model?: { provider: string; id: string }, signal?: AbortSignal): Promise<ResearchResult> {
  return requestJson<ResearchResult>(`${BASE}/api/ask-research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, model }),
    signal,
  })
}

export function agentResearch(
  query: string,
  mode: ResearchMode,
  model?: { provider: string; id: string },
  smallModel?: { provider: string; id: string },
  onProgress?: (progress: AgentResearchProgress) => void,
  signal?: AbortSignal,
): Promise<AgentResearchResult & { researchId?: string }> {
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/agent-research`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, mode, model, smallModel }),
          signal,
        })
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
        let currentEvent = ""
        let resolved = false
        let capturedResearchId: string | undefined

        const processChunk = (chunk: string) => {
          buffer += chunk
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith("data: ") && currentEvent) {
              try {
                const data = JSON.parse(line.slice(6))
                if (currentEvent === "started") {
                  capturedResearchId = data.researchId
                } else if (currentEvent === "step" && onProgress) {
                  onProgress(data as AgentResearchProgress)
                } else if (currentEvent === "done") {
                  resolved = true
                  resolve({ ...(data as AgentResearchResult), researchId: capturedResearchId })
                } else if (currentEvent === "error") {
                  resolved = true
                  reject(new Error(data.error || "Unknown error"))
                }
              } catch (e) { if (import.meta.env.DEV) console.warn('[ask] parse event data failed:', e) }
              currentEvent = ""
            }
          }
        }

        const read = async (): Promise<void> => {
          const { done, value } = await reader!.read()
          if (done) {
            if (!resolved) {
              resolved = true
              reject(new Error("Stream ended without completion"))
            }
            return
          }
          processChunk(decoder.decode(value, { stream: true }))
          return read()
        }

        read()
      } catch (e) {
        reject(e)
      }
    })()
  })
}

export async function getResearchStatus(researchId: string): Promise<{
  researchId: string
  status: "running" | "completed" | "failed"
  mode: string
  query: string
  progress: AgentResearchProgress[]
  createdAt: number
  updatedAt: number
}> {
  return requestJson(`${BASE}/api/agent-research/${researchId}/status`)
}

export async function getResearchResult(researchId: string): Promise<AgentResearchResult> {
  return requestJson(`${BASE}/api/agent-research/${researchId}/result`)
}

export async function askSummarize(params: {
  query: string
  title: string
  content: string
  url?: string
  tags?: string[]
  keywords?: string[]
}): Promise<SummarizeResult> {
  return requestJson<SummarizeResult>(`${BASE}/api/ask-summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
}
