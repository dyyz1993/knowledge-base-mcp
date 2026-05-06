import { create } from "zustand"
import type { ModelInfo, SessionInfo, Message, Favorite, KBDoc } from "../services/api"
import * as api from "../services/api"

export interface TimelineEvent {
  type: "thinking" | "text" | "tool_call" | "tool_result"
  round: number
  content: string
  name?: string
  args?: string
  result?: string
}

export interface MergedTimelineEvent extends TimelineEvent {
  id: number
}

export interface SessionStreamState {
  isStreaming: boolean
  streamingContent: string
  streamingThinking: string
  streamingToolCalls: { name: string; args: string; result: string }[]
  streamingTimeline: TimelineEvent[]
  abortController: AbortController | null
  suggestions: string[]
}

interface ChatState {
  sessions: SessionInfo[]
  currentSessionId: string | null
  messages: Message[]
  models: ModelInfo[]
  currentModel: { provider: string; id: string } | null
  favorites: Favorite[]
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
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  models: [],
  currentModel: null,
  favorites: [],
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
    set({ messages: msgs })
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

    await api.streamChat({
      message: content,
      sessionId: targetSessionId,
      model: currentModel || undefined,
      onToken: (delta, round) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const state = states.get(targetSessionId)
          if (!state) return s
          states.set(targetSessionId, {
            ...state,
            streamingContent: state.streamingContent + delta,
            streamingTimeline: [...state.streamingTimeline, { type: "text", round, content: delta }],
          })
          return { streamStates: states }
        })
      },
      onThinking: (delta, round) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const state = states.get(targetSessionId)
          if (!state) return s
          states.set(targetSessionId, {
            ...state,
            streamingThinking: state.streamingThinking + delta,
            streamingTimeline: [...state.streamingTimeline, { type: "thinking", round, content: delta }],
          })
          return { streamStates: states }
        })
      },
      onToolCall: (name, args, round) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const state = states.get(targetSessionId)
          if (!state) return s
          states.set(targetSessionId, {
            ...state,
            streamingToolCalls: [...state.streamingToolCalls, { name, args, result: "" }],
            streamingTimeline: [...state.streamingTimeline, { type: "tool_call", round, content: "", name, args }],
          })
          return { streamStates: states }
        })
      },
      onToolResult: (name, result, round) => {
        set((s) => {
          const states = new Map(s.streamStates)
          const state = states.get(targetSessionId)
          if (!state) return s

          const tcs = [...state.streamingToolCalls]
          const idx = tcs.findIndex((tc) => tc.name === name && !tc.result)
          if (idx >= 0) tcs[idx] = { ...tcs[idx], result }

          states.set(targetSessionId, {
            ...state,
            streamingToolCalls: tcs,
            streamingTimeline: [...state.streamingTimeline, { type: "tool_result", round, content: result, name }],
          })
          return { streamStates: states }
        })
      },
      onDone: () => {
        const finalState = get().streamStates.get(targetSessionId)
        const rawContent = finalState?.streamingContent || ""

        const closedMatch = rawContent.match(/\[SUGGESTIONS\]\r?\n([\s\S]*?)\[\/SUGGESTIONS\]/)
        const openMatch = !closedMatch ? rawContent.match(/\[SUGGESTIONS\]\r?\n([\s\S]+)$/) : null
        const suggestionMatch = closedMatch || openMatch
        let cleanContent = rawContent
        let suggestions: string[] = []
        if (suggestionMatch) {
          cleanContent = rawContent.replace(suggestionMatch[0], "").trim()
          suggestions = suggestionMatch[1]
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => /^\d+\.\s/.test(l))
            .map((l) => l.replace(/^\d+\.\s*/, ""))
            .filter(Boolean)
        }

        if (cleanContent) {
          const assistantMsg: Message = { role: "assistant", content: cleanContent, timestamp: Date.now() }
          set((s) => ({ messages: [...s.messages, assistantMsg] }))
        }

        set((s) => {
          const states = new Map(s.streamStates)
          states.set(targetSessionId, { ...emptyStreamState(), suggestions })
          return { streamStates: states }
        })
      },
      onError: (error) => {
        const errMsg: Message = { role: "assistant", content: `⚠️ Error: ${error}`, timestamp: Date.now() }
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

  searchKB: async (query) => {
    if (!query.trim()) { set({ kbResults: [] }); return }
    const kbResults = await api.searchKB(query)
    set({ kbResults })
  },

  setKBQuery: (q) => set({ kbQuery: q }),
}))
