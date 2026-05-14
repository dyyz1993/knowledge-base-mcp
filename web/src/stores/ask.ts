import { create } from "zustand"
import { smartAsk, ingestWebContent, askSearch, type AskResult, type PipelineSearchResponse } from "../services/api"

interface Message {
  id: string
  role: "user" | "system"
  content: string
  result?: AskResult
  searchResult?: PipelineSearchResponse
  timestamp: number
}

interface AskState {
  messages: Message[]
  loading: boolean
  ask: (query: string) => Promise<void>
  search: (query: string) => Promise<void>
  ingest: (url: string, title: string, content: string, tags?: string[]) => Promise<void>
  ingestFromSearch: (query: string, title: string, content: string, url?: string) => Promise<void>
  generateWorkKey: (query: string, results: import("../services/api").PipelineSearchResult[]) => Promise<void>
  clear: () => void
}

let msgId = 0

export const useAskStore = create<AskState>((set) => ({
  messages: [],
  loading: false,

  ask: async (query) => {
    const userMsg: Message = {
      id: `msg-${++msgId}`,
      role: "user",
      content: query,
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, userMsg], loading: true }))

    try {
      const result = await smartAsk(query)
      if (result.from_kb) {
        const systemMsg: Message = {
          id: `msg-${++msgId}`,
          role: "system",
          content: result.title || "知识库命中",
          result,
          timestamp: Date.now(),
        }
        set((s) => ({ messages: [...s.messages, systemMsg], loading: false }))
      } else {
        try {
          const searchResult = await askSearch(query)
          const systemMsg: Message = {
            id: `msg-${++msgId}`,
            role: "system",
            content: searchResult.hint,
            result,
            searchResult,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, systemMsg], loading: false }))
        } catch {
          const systemMsg: Message = {
            id: `msg-${++msgId}`,
            role: "system",
            content: result.hint || "未命中知识库",
            result,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, systemMsg], loading: false }))
        }
      }
    } catch {
      const errorMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: "查询失败，请重试",
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, errorMsg], loading: false }))
    }
  },

  search: async (query) => {
    const userMsg: Message = {
      id: `msg-${++msgId}`,
      role: "user",
      content: `🔍 ${query}`,
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, userMsg], loading: true }))

    try {
      const searchResult = await askSearch(query)
      const systemMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: searchResult.hint,
        searchResult,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, systemMsg], loading: false }))
    } catch {
      const errorMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: "搜索失败，请重试",
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, errorMsg], loading: false }))
    }
  },

  ingest: async (url, title, content, tags) => {
    try {
      const result = await ingestWebContent({ url, title, content, tags })
      const msg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: `已存储: ${result.title} (id: ${result.id})`,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, msg] }))
    } catch {
      const msg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: "存储失败",
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, msg] }))
    }
  },

  ingestFromSearch: async (query, title, content, url) => {
    try {
      const { askSummarize } = await import("../services/api")
      const result = await askSummarize({ query, title, content, url, tags: ["reference", "web-ingested"] })
      const msg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: `已沉淀: ${result.title} (id: ${result.id})`,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, msg] }))
    } catch {
      const msg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: "沉淀失败",
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, msg] }))
    }
  },

  generateWorkKey: async (query, results) => {
    try {
      const { askWorkKey } = await import("../services/api")
      const result = await askWorkKey(query, results)
      const msg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: `Work Key 已生成: ${result.title} (id: ${result.id})`,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, msg] }))
    } catch {
      const msg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: "Work Key 生成失败",
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, msg] }))
    }
  },

  clear: () => set({ messages: [] }),
}))
