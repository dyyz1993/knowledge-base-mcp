import { create } from "zustand"
import type { ModelInfo, SessionInfo, Message, Favorite, KBDoc, TokenUsage, SessionFavorite } from "../services/api"
import * as api from "../services/api"

export interface TimelineEvent {
  type: "thinking" | "text" | "tool_call" | "tool_result"
  round: number
  content: string
  id?: string
  name?: string
  args?: string
  result?: string
}

export interface MergedTimelineEvent extends TimelineEvent {
  _idx: number
}

export interface SessionStreamState {
  isStreaming: boolean
  streamingContent: string
  streamingThinking: string
  streamingToolCalls: { id: string; name: string; args: string; result: string }[]
  streamingTimeline: TimelineEvent[]
  abortController: AbortController | null
  suggestions: string[]
  usage?: TokenUsage
  researchProgress: { step: string; status: string; budget?: { usedSteps: number; maxSteps: number } }[]
}

interface ChatState {
  sessions: SessionInfo[]
  currentSessionId: string | null
  messages: Message[]
  models: ModelInfo[]
  currentModel: { provider: string; id: string } | null
  favorites: Favorite[]
  sessionFavorites: string[]
  streamStates: Map<string, SessionStreamState>
  kbResults: KBDoc[]
  kbQuery: string

  loadSessions: () => Promise<void>
  createSession: () => Promise<void>
  deleteSession: (id: string) => Promise<void>
  switchSession: (id: string) => Promise<void>
  loadModels: () => Promise<void>
  setModel: (provider: string, id: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  abort: () => void
  loadFavorites: () => Promise<void>
  addFavorite: (messageId: string, content: string) => Promise<void>
  removeFavorite: (id: string) => Promise<void>
  loadSessionFavorites: () => Promise<void>
  toggleSessionFavorite: (sessionId: string) => Promise<void>
  renameSessionLocal: (id: string, name: string) => Promise<void>
  searchKB: (query: string) => Promise<void>
  setKBQuery: (q: string) => void
}

function emptyStreamState(): SessionStreamState {
  return {
    isStreaming: false,
    streamingContent: "",
    streamingThinking: "",
    streamingToolCalls: [],
    streamingTimeline: [],
    abortController: null,
    suggestions: [],
    researchProgress: [],
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  models: [],
  currentModel: null,
  favorites: [],
  sessionFavorites: [],
  streamStates: new Map(),
  kbResults: [],
  kbQuery: "",

  loadSessions: async () => {
    const sessions = await api.listSessions()
    set({ sessions })
    if (!get().currentSessionId && sessions.length > 0) {
      const id = sessions[0].id
      set({ currentSessionId: id })
      const msgs = await api.getSessionMessages(id)
      set({ messages: msgs })
    }
  },

  createSession: async () => {
    const sess = await api.createSession()
    const entry: SessionInfo = { ...sess, createdAt: Date.now(), messageCount: 0 }
    set((s) => ({
      sessions: [entry, ...s.sessions],
      currentSessionId: sess.id,
      messages: [],
    }))
  },

  deleteSession: async (id) => {
    const state = get().streamStates.get(id)
    if (state?.abortController) state.abortController.abort()

    set((s) => {
      const streamStates = new Map(s.streamStates)
      streamStates.delete(id)
      const sessions = s.sessions.filter((x) => x.id !== id)
      const currentSessionId = s.currentSessionId === id
        ? (sessions[0]?.id || null)
        : s.currentSessionId
      return { sessions, currentSessionId, messages: s.currentSessionId === id ? [] : s.messages, streamStates }
    })
    const { currentSessionId } = get()
    if (currentSessionId) {
      const msgs = await api.getSessionMessages(currentSessionId)
      set({ messages: msgs })
    }
  },

  switchSession: async (id) => {
    set({ currentSessionId: id, messages: [] })
    const msgs = await api.getSessionMessages(id)
    const suggestionsMsg = msgs.filter((m) => m.role === "suggestions").slice(-1)[0]
    let restoredSuggestions: string[] = []
    if (suggestionsMsg) {
      try { restoredSuggestions = JSON.parse(suggestionsMsg.content) } catch { /* ignore */ }
    }
    const usageMsg = msgs.filter((m) => m.role === "usage").slice(-1)[0]
    let restoredUsage: TokenUsage | undefined
    if (usageMsg) {
      try { restoredUsage = JSON.parse(usageMsg.content) } catch { /* ignore */ }
    }
    set((s) => {
      const states = new Map(s.streamStates)
      const prev = states.get(id)
      states.set(id, { ...(prev || emptyStreamState()), suggestions: restoredSuggestions, usage: restoredUsage })
      return { messages: msgs, streamStates: states }
    })
  },

  loadModels: async () => {
    const data = await api.getModels()
    const resolved = data.current || (data.models.length > 0 ? { provider: data.models[0].provider, id: data.models[0].id } : null)
    set({ models: data.models, currentModel: resolved })
  },

  setModel: async (provider, id) => {
    const { currentSessionId } = get()
    if (!currentSessionId) return
    await api.setModel(currentSessionId, provider, id)
    set({ currentModel: { provider, id } })
  },

  sendMessage: async (content) => {
    const { currentSessionId, currentModel, streamStates } = get()
    if (!currentSessionId) return
    const currentState = streamStates.get(currentSessionId)
    if (currentState?.isStreaming) return

    const targetSessionId = currentSessionId

    const ctrl = new AbortController()
    const initialStreamState: SessionStreamState = {
      isStreaming: true,
      streamingContent: "",
      streamingThinking: "",
      streamingToolCalls: [],
      streamingTimeline: [],
      abortController: ctrl,
      suggestions: [],
      researchProgress: [],
    }
    set((s) => {
      const states = new Map(s.streamStates)
      states.set(targetSessionId, initialStreamState)
      return { streamStates: states }
    })

    const userMsg: Message = { role: "user", content, timestamp: Date.now() }
    set((s) => ({ messages: [...s.messages, userMsg] }))

    if (get().messages.length <= 1) {
      const name = content.slice(0, 30) + (content.length > 30 ? "..." : "")
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === targetSessionId ? { ...sess, name } : sess
        ),
      }))
      api.renameSession(targetSessionId, name).catch(() => {})
    }

    let textBuffer = ""
    let textRound = 0
    let textFlushTimer: ReturnType<typeof setTimeout> | null = null
    let thinkingBuffer = ""
    let thinkingRound = 0
    let thinkingFlushTimer: ReturnType<typeof setTimeout> | null = null

    const flushTextBuffer = () => {
      if (!textBuffer) return
      const batch = textBuffer
      const round = textRound
      textBuffer = ""
      textFlushTimer = null
      set((s) => {
        const states = new Map(s.streamStates)
        const state = states.get(targetSessionId)
        if (!state) return s
        states.set(targetSessionId, {
          ...state,
          streamingContent: state.streamingContent + batch,
          streamingTimeline: [...state.streamingTimeline, { type: "text", round, content: batch }],
        })
        return { streamStates: states }
      })
    }

    const flushThinkingBuffer = () => {
      if (!thinkingBuffer) return
      const batch = thinkingBuffer
      const round = thinkingRound
      thinkingBuffer = ""
      thinkingFlushTimer = null
      set((s) => {
        const states = new Map(s.streamStates)
        const state = states.get(targetSessionId)
        if (!state) return s
        states.set(targetSessionId, {
          ...state,
          streamingThinking: state.streamingThinking + batch,
          streamingTimeline: [...state.streamingTimeline, { type: "thinking", round, content: batch }],
        })
        return { streamStates: states }
      })
    }

    await api.streamChat({
      message: content,
      sessionId: targetSessionId,
      model: currentModel || undefined,
      onToken: (delta, round) => {
        textBuffer += delta
        textRound = round
        if (!textFlushTimer) {
          textFlushTimer = setTimeout(flushTextBuffer, 50)
        }
      },
      onThinking: (delta, round) => {
        thinkingBuffer += delta
        thinkingRound = round
        if (!thinkingFlushTimer) {
          thinkingFlushTimer = setTimeout(flushThinkingBuffer, 50)
        }
      },
      onToolCall: (id, name, args, round) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const state = states.get(targetSessionId)
          if (!state) return s
          states.set(targetSessionId, {
            ...state,
            streamingToolCalls: [...state.streamingToolCalls, { id, name, args, result: "" }],
            streamingTimeline: [...state.streamingTimeline, { type: "tool_call", round, content: "", id, name, args }],
          })
          return { streamStates: states }
        })
      },
      onToolResult: (id, name, result, round) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const state = states.get(targetSessionId)
          if (!state) return s

          const tcs = [...state.streamingToolCalls]
          const tcIdx = tcs.findIndex((tc) => tc.id === id)
          if (tcIdx >= 0) tcs[tcIdx] = { ...tcs[tcIdx], result }

          const timeline = [...state.streamingTimeline]
          const toolCallIdx = timeline.findIndex(
            (e) => e.type === "tool_call" && e.id === id
          )

          if (toolCallIdx >= 0) {
            timeline[toolCallIdx] = { ...timeline[toolCallIdx], result }
          } else {
            timeline.push({ type: "tool_result", round, content: result, name })
          }

          states.set(targetSessionId, {
            ...state,
            streamingToolCalls: tcs,
            streamingTimeline: timeline,
          })
          return { streamStates: states }
        })
      },
      onDone: () => {
        if (textFlushTimer) { clearTimeout(textFlushTimer); textFlushTimer = null }
        if (textBuffer) {
          const batch = textBuffer
          const round = textRound
          textBuffer = ""
          set((s) => {
            const states = new Map(s.streamStates)
            const state = states.get(targetSessionId)
            if (!state) return s
            states.set(targetSessionId, {
              ...state,
              streamingContent: state.streamingContent + batch,
              streamingTimeline: [...state.streamingTimeline, { type: "text", round, content: batch }],
            })
            return { streamStates: states }
          })
        }
        if (thinkingFlushTimer) { clearTimeout(thinkingFlushTimer); thinkingFlushTimer = null }
        if (thinkingBuffer) {
          const batch = thinkingBuffer
          const round = thinkingRound
          thinkingBuffer = ""
          set((s) => {
            const states = new Map(s.streamStates)
            const state = states.get(targetSessionId)
            if (!state) return s
            states.set(targetSessionId, {
              ...state,
              streamingThinking: state.streamingThinking + batch,
              streamingTimeline: [...state.streamingTimeline, { type: "thinking", round, content: batch }],
            })
            return { streamStates: states }
          })
        }
        const finalState = get().streamStates.get(targetSessionId)
        const rawContent = finalState?.streamingContent || ""
        const toolCalls = finalState?.streamingToolCalls || []
        const finalUsage = finalState?.usage

        const cleanContent = rawContent.replace(/\[SUGGESTIONS\][\s\S]*?(?:\[\/SUGGESTIONS\]|$)/, "").trim()

        let finalContent = cleanContent
        if (toolCalls.length > 0) {
          const toolSummary = toolCalls.map((tc) => `[工具: ${tc.name} → ${tc.result || "executing..."}]`).join("\n")
          finalContent = `${toolSummary}\n\n${finalContent}`
        }

        if (finalContent) {
          const assistantMsg: Message = { role: "assistant", content: finalContent, timestamp: Date.now() }
          set((s) => ({ messages: [...s.messages, assistantMsg] }))
        }

        set((s) => {
          const states = new Map(s.streamStates)
          const prev = states.get(targetSessionId)
          states.set(targetSessionId, { ...emptyStreamState(), suggestions: prev?.suggestions ?? [], usage: finalUsage })
          return { streamStates: states }
        })
      },
      onSuggestions: (suggestions) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const ss = states.get(targetSessionId)
          if (ss) {
            states.set(targetSessionId, { ...ss, suggestions })
          }
          return { streamStates: states }
        })
      },
      onUsage: (usage: TokenUsage) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const ss = states.get(targetSessionId)
          if (ss) {
            states.set(targetSessionId, { ...ss, usage })
          }
          return { streamStates: states }
        })
      },
      onResearchProgress: (progress) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const ss = states.get(targetSessionId)
          if (!ss) return s
          const existing = [...ss.researchProgress]
          const idx = existing.findIndex(p => p.step === progress.step)
          const entry = { step: progress.step, status: progress.status, budget: progress.budget }
          if (idx >= 0) {
            existing[idx] = entry
          } else {
            existing.push(entry)
          }
          states.set(targetSessionId, { ...ss, researchProgress: existing.slice(-20) })
          return { streamStates: states }
        })
      },
      onError: (error) => {
        let errorContent = `⚠️ Error: ${error}`
        if (error.startsWith("RATE_LIMITED:")) {
          const modelId = error.replace("RATE_LIMITED:", "")
          errorContent = `⚠️ **模型 ${modelId} 请求频率已达上限**\n\n请在左侧 **模型选择器** 中切换到其他模型（如 glm-4.5-air）后重试。\n\n> 免费模型有请求频率限制，稍后再试或切换到其他可用模型。`
        }
        const errMsg: Message = { role: "assistant", content: errorContent, timestamp: Date.now() }
        set((s) => {
          const states = new Map(s.streamStates)
          states.set(targetSessionId, emptyStreamState())
          return { streamStates: states, messages: [...s.messages, errMsg] }
        })
      },
    } as Parameters<typeof api.streamChat>[0])
  },

  abort: () => {
    const { currentSessionId, streamStates } = get()
    if (!currentSessionId) return
    const state = streamStates.get(currentSessionId)
    if (state?.abortController) {
      state.abortController.abort()
      if (state.streamingContent) {
        set((s) => ({
          messages: [...s.messages, { role: "assistant", content: state.streamingContent, timestamp: Date.now() } as Message],
        }))
      }
      set((s) => {
        const states = new Map(s.streamStates)
        states.set(currentSessionId, emptyStreamState())
        return { streamStates: states }
      })
    }
  },

  loadFavorites: async () => {
    const favorites = await api.listFavorites()
    set({ favorites })
  },

  addFavorite: async (messageId, content) => {
    const { currentSessionId } = get()
    if (!currentSessionId) return
    const fav = await api.addFavorite(currentSessionId, messageId, content)
    set((s) => ({
      favorites: [...s.favorites, {
        id: fav.id,
        sessionId: currentSessionId,
        messageId,
        content,
        createdAt: Date.now(),
      }],
    }))
  },

  removeFavorite: async (id) => {
    await api.deleteFavorite(id)
    set((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) }))
  },

  loadSessionFavorites: async () => {
    const favs = await api.listSessionFavorites()
    set({ sessionFavorites: favs.map((f) => f.sessionId) })
  },

  toggleSessionFavorite: async (sessionId) => {
    const { sessionFavorites } = get()
    if (sessionFavorites.includes(sessionId)) {
      await api.removeSessionFavorite(sessionId)
      set((s) => ({ sessionFavorites: s.sessionFavorites.filter((id) => id !== sessionId) }))
    } else {
      await api.addSessionFavorite(sessionId)
      set((s) => ({ sessionFavorites: [...s.sessionFavorites, sessionId] }))
    }
  },

  renameSessionLocal: async (id, name) => {
    await api.renameSession(id, name)
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, name } : sess
      ),
    }))
  },

  searchKB: async (query) => {
    if (!query.trim()) { set({ kbResults: [] }); return }
    const kbResults = await api.searchKB(query)
    set({ kbResults })
  },

  setKBQuery: (q) => set({ kbQuery: q }),
}))
