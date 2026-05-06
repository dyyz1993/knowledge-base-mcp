import { create } from "zustand"
import type { ModelInfo, SessionInfo, Message, Favorite, KBDoc } from "../services/api"
import * as api from "../services/api"

interface ChatState {
  sessions: SessionInfo[]
  currentSessionId: string | null
  messages: Message[]
  models: ModelInfo[]
  currentModel: { provider: string; id: string } | null
  favorites: Favorite[]
  isStreaming: boolean
  streamingContent: string
  streamingThinking: string
  streamingToolCalls: { name: string; args: string; result: string }[]
  kbResults: KBDoc[]
  kbQuery: string
  abortController: AbortController | null

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

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  models: [],
  currentModel: null,
  favorites: [],
  isStreaming: false,
  streamingContent: "",
  streamingThinking: "",
  streamingToolCalls: [],
  kbResults: [],
  kbQuery: "",
  abortController: null,

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
    await api.deleteSession(id)
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      const currentSessionId = s.currentSessionId === id
        ? (sessions[0]?.id || null)
        : s.currentSessionId
      return { sessions, currentSessionId, messages: s.currentSessionId === id ? [] : s.messages }
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
    const { currentSessionId, currentModel, isStreaming } = get()
    if (!currentSessionId || isStreaming) return

    const userMsg: Message = { role: "user", content, timestamp: Date.now() }
    set((s) => ({
      messages: [...s.messages, userMsg],
      isStreaming: true,
      streamingContent: "",
      streamingThinking: "",
      streamingToolCalls: [],
    }))

    const ctrl = new AbortController()
    set({ abortController: ctrl })

    await api.streamChat({
      message: content,
      sessionId: currentSessionId,
      model: currentModel || undefined,
      onToken: (delta) => {
        set((s) => ({ streamingContent: s.streamingContent + delta }))
      },
      onThinking: (delta) => {
        set((s) => ({ streamingThinking: s.streamingThinking + delta }))
      },
      onToolCall: (name, args) => {
        set((s) => ({
          streamingToolCalls: [...s.streamingToolCalls, { name, args, result: "" }],
        }))
      },
      onToolResult: (name, result) => {
        set((s) => ({
          streamingToolCalls: s.streamingToolCalls.map((tc) =>
            tc.name === name && !tc.result ? { ...tc, result } : tc
          ),
        }))
      },
      onDone: () => {
        const { streamingContent, messages } = get()
        if (streamingContent) {
          const assistantMsg: Message = {
            role: "assistant",
            content: streamingContent,
            timestamp: Date.now(),
          }
          set({ messages: [...messages, assistantMsg] })
        }
        set({
          isStreaming: false,
          streamingContent: "",
          streamingThinking: "",
          streamingToolCalls: [],
          abortController: null,
        })
      },
      onError: (error) => {
        const errMsg: Message = {
          role: "assistant",
          content: `⚠️ Error: ${error}`,
          timestamp: Date.now(),
        }
        set((s) => ({
          messages: [...s.messages, errMsg],
          isStreaming: false,
          streamingContent: "",
          streamingThinking: "",
          streamingToolCalls: [],
          abortController: null,
        }))
      },
    } as Parameters<typeof api.streamChat>[0])
  },

  abort: () => {
    const { abortController } = get()
    if (abortController) {
      abortController.abort()
      const { streamingContent, messages } = get()
      if (streamingContent) {
        set({
          messages: [...messages, { role: "assistant", content: streamingContent, timestamp: Date.now() }],
        })
      }
      set({
        isStreaming: false,
        streamingContent: "",
        streamingThinking: "",
        streamingToolCalls: [],
        abortController: null,
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
