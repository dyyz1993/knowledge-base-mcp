import { BASE } from "./client"
import type {
  ModelInfo,
  SessionInfo,
  Message,
  Favorite,
  TokenUsage,
  SessionFavorite,
  StreamCallbacks,
} from "./types"

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function streamChat(params: {
  message: string
  sessionId: string
  model?: { provider: string; id: string }
  signal?: AbortSignal
} & StreamCallbacks): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: params.message,
      sessionId: params.sessionId,
      model: params.model,
    }),
    signal: params.signal,
  })

  if (!res.ok) {
    const text = await res.text()
    params.onError(text || `HTTP ${res.status}`)
    return
  }

  if (!res.body) {
    params.onError("Response body is null")
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = ""

  let doneCalled = false
  let lastEventTime = Date.now()
  const heartbeatTimeout = 30000
  const heartbeatCheck = setInterval(() => {
    if (Date.now() - lastEventTime > heartbeatTimeout) {
      params.onError("SSE 心跳超时: 30秒未收到数据")
      reader.cancel().catch((e) => { if (import.meta.env.DEV) console.warn('[chat] reader.cancel failed:', e) })
      clearInterval(heartbeatCheck)
    }
  }, 5000)

  try {
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    lastEventTime = Date.now()
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith("data: ") && currentEvent) {
        const raw = line.slice(6)
        let data: Record<string, unknown>
        try { data = JSON.parse(raw) } catch { continue }
        const round = typeof data.round === "number" ? data.round : 0
        switch (currentEvent) {
          case "token": params.onToken(String(data.delta || ""), round); break
          case "thinking": params.onThinking(String(data.delta || ""), round); break
          case "tool_call": params.onToolCall(String(data.id || ""), String(data.name || ""), String(data.args || ""), round); break
          case "tool_call_delta": break
          case "tool_result": params.onToolResult(String(data.id || ""), String(data.name || ""), String(data.content || data.result || ""), round); break
          case "done": {
            doneCalled = true
            if (data.usage) {
              params.onUsage?.(data.usage as TokenUsage)
            }
            params.onDone(String(data.messageId || ""), round)
            break
          }
          case "suggestions":
            if (params.onSuggestions) {
              try { params.onSuggestions(JSON.parse(String(data.suggestions || data.data || "[]"))) } catch { /* ignore */ }
            }
            break
          case "error": {
            const errMsg = String(data.error || "Unknown error")
            const hint = data.hint ? `\n\n💡 ${data.hint}` : ""
            params.onError(errMsg + hint)
            break
          }
          case "research_progress":
            if (params.onResearchProgress) {
              params.onResearchProgress(data as { step: string; status: string; budget?: { usedSteps: number; maxSteps: number }; round: number })
            }
            break
        }
        currentEvent = ""
      }
    }
  }

  if (!doneCalled && params.onDone) {
    params.onDone("", 0)
  }
  } finally {
    clearInterval(heartbeatCheck)
  }
}

export async function getModels(): Promise<{ models: ModelInfo[]; current: { provider: string; id: string } | null }> {
  return requestJson(`${BASE}/api/models`)
}

export async function setModel(sessionId: string, provider: string, id: string) {
  return requestJson(`${BASE}/api/models`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, provider, id }),
  })
}

export async function listSessions(): Promise<SessionInfo[]> {
  return requestJson(`${BASE}/api/sessions`)
}

export async function createSession(): Promise<{ id: string; name: string }> {
  return requestJson(`${BASE}/api/sessions`, { method: "POST" })
}

export async function renameSession(id: string, name: string) {
  await fetch(`${BASE}/api/sessions/${id}/rename`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  })
}

export async function deleteSession(id: string) {
  await fetch(`${BASE}/api/sessions/${id}`, { method: "DELETE" })
}

export async function getSessionMessages(id: string): Promise<Message[]> {
  return requestJson(`${BASE}/api/sessions/${id}/messages`)
}

export async function listFavorites(): Promise<Favorite[]> {
  return requestJson(`${BASE}/api/favorites`)
}

export async function addFavorite(sessionId: string, messageId: string, content: string): Promise<{ id: string }> {
  return requestJson(`${BASE}/api/favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, messageId, content }),
  })
}

export async function deleteFavorite(id: string) {
  await fetch(`${BASE}/api/favorites/${id}`, { method: "DELETE" })
}

export async function listSessionFavorites(): Promise<SessionFavorite[]> {
  const res = await fetch(`${BASE}/api/session-favorites`)
  if (!res.ok) return []
  return res.json()
}

export async function addSessionFavorite(sessionId: string, note?: string): Promise<void> {
  await fetch(`${BASE}/api/session-favorites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, note }),
  })
}

export async function removeSessionFavorite(sessionId: string): Promise<void> {
  await fetch(`${BASE}/api/session-favorites/${sessionId}`, { method: "DELETE" })
}

export function buildShareUrl(sessionId: string): string {
  const loc = window.location
  return `${loc.protocol}//${loc.hostname}:${loc.port}/api/share/${sessionId}`
}

export async function exportChatHistory(sessionId?: string): Promise<void> {
  const url = sessionId
    ? `${BASE}/api/chat/export/${sessionId}?format=markdown`
    : `${BASE}/api/chat/export?format=markdown`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Export failed: ${text || `HTTP ${res.status}`}`)
  }
  const blob = await res.blob()
  const disposition = res.headers.get("Content-Disposition") || ""
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
  const filename = filenameMatch ? filenameMatch[1] : `chat-export-${new Date().toISOString().split("T")[0]}.md`
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
