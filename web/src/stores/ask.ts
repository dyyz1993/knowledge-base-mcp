import { create } from "zustand"
import { smartAsk, ingestWebContent, type AskResult } from "../services/api"

interface Message {
  id: string
  role: "user" | "system"
  content: string
  result?: AskResult
  timestamp: number
}

interface AskState {
  messages: Message[]
  loading: boolean
  ask: (query: string) => Promise<void>
  ingest: (url: string, title: string, content: string, tags?: string[]) => Promise<void>
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
      const systemMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: result.from_kb ? result.title || "知识库命中" : "知识库未命中",
        result,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, systemMsg], loading: false }))
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

  ingest: async (url, title, content, tags) => {
    try {
      const result = await ingestWebContent({ url, title, content, tags })
      const msg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: `✅ 已存储: ${result.title} (id: ${result.id})`,
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

  clear: () => set({ messages: [] }),
}))
