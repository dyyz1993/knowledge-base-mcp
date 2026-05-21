import { create } from "zustand"
import { smartAsk, ingestWebContent, askSearch, askResearch, agentResearch, type AskResult, type PipelineSearchResponse, type ResearchResult, type AgentResearchResult, type AgentResearchProgress, type ResearchMode } from "../services/api"
import { useChatStore } from "./chat"

interface Message {
  id: string
  role: "user" | "system"
  content: string
  result?: AskResult
  searchResult?: PipelineSearchResponse
  researchResult?: ResearchResult
  agentResearchResult?: AgentResearchResult
  agentResearchProgress?: AgentResearchProgress[]
  errorDetail?: string
  timestamp: number
}

interface AskState {
  messages: Message[]
  loading: boolean
  ask: (query: string) => Promise<void>
  search: (query: string) => Promise<void>
  research: (query: string) => Promise<void>
  agentResearchAction: (query: string, mode: ResearchMode) => Promise<void>
  ingest: (url: string, title: string, content: string, tags?: string[]) => Promise<void>
  ingestFromSearch: (query: string, title: string, content: string, url?: string) => Promise<void>
  generateWorkKey: (query: string, results: import("../services/api").PipelineSearchResult[]) => Promise<void>
  cancel: () => void
  clear: () => void
}

let msgId = 0
let abortController: AbortController | null = null

function getModel() {
  return useChatStore.getState().currentModel
}

export const useAskStore = create<AskState>((set, get) => ({
  messages: [],
  loading: false,

  cancel: () => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    set({ loading: false })
  },

  ask: async (query) => {
    const ac = new AbortController()
    abortController = ac
    const userMsg: Message = {
      id: `msg-${++msgId}`,
      role: "user",
      content: query,
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, userMsg], loading: true }))

    try {
      const result = await smartAsk(query, ac.signal)
      if (ac.signal.aborted) return
      if (result.error) {
        const errorMsg: Message = {
          id: `msg-${++msgId}`,
          role: "system",
          content: result.hint || "查询失败",
          result,
          errorDetail: result.error,
          timestamp: Date.now(),
        }
        set((s) => ({ messages: [...s.messages, errorMsg], loading: false }))
        return
      }
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
          const searchResult = await askSearch(query, getModel() || undefined, ac.signal)
          if (ac.signal.aborted) return
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
          if (ac.signal.aborted) return
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
    } catch (e: unknown) {
      if (ac.signal.aborted) return
      const errorDetail = e instanceof Error ? e.message : String(e)
      const isAbort = errorDetail === "AbortError" || (e instanceof DOMException && e.name === "AbortError")
      if (isAbort) return
      const errorMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: "查询失败，请重试",
        errorDetail,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, errorMsg], loading: false }))
    } finally {
      if (abortController === ac) abortController = null
    }
  },

  search: async (query) => {
    const ac = new AbortController()
    abortController = ac
    const userMsg: Message = {
      id: `msg-${++msgId}`,
      role: "user",
      content: `🔍 ${query}`,
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, userMsg], loading: true }))

    try {
      const searchResult = await askSearch(query, getModel() || undefined, ac.signal)
      if (ac.signal.aborted) return
      const systemMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: searchResult.hint,
        searchResult,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, systemMsg], loading: false }))
    } catch (e: unknown) {
      if (ac.signal.aborted) return
      const errorDetail = e instanceof Error ? e.message : String(e)
      const isAbort = errorDetail === "AbortError" || (e instanceof DOMException && e.name === "AbortError")
      if (isAbort) return
      const errorMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: "搜索失败，请重试",
        errorDetail,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, errorMsg], loading: false }))
    } finally {
      if (abortController === ac) abortController = null
    }
  },

  research: async (query) => {
    const ac = new AbortController()
    abortController = ac
    const userMsg: Message = {
      id: `msg-${++msgId}`,
      role: "user",
      content: `🔬 ${query}`,
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, userMsg], loading: true }))

    try {
      const researchResult = await askResearch(query, getModel() || undefined, ac.signal)
      if (ac.signal.aborted) return
      const systemMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: researchResult.summary || "深度研究完成",
        researchResult,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, systemMsg], loading: false }))
    } catch (e: unknown) {
      if (ac.signal.aborted) return
      const errorDetail = e instanceof Error ? e.message : String(e)
      const isAbort = errorDetail === "AbortError" || (e instanceof DOMException && e.name === "AbortError")
      if (isAbort) return
      const errorMsg: Message = {
        id: `msg-${++msgId}`,
        role: "system",
        content: "深度研究失败，请重试",
        errorDetail,
        timestamp: Date.now(),
      }
      set((s) => ({ messages: [...s.messages, errorMsg], loading: false }))
    } finally {
      if (abortController === ac) abortController = null
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
      const result = await askWorkKey(query, results, getModel() || undefined)
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

  agentResearchAction: async (query, mode) => {
    const ac = new AbortController()
    abortController = ac
    const userMsg: Message = {
      id: `msg-${++msgId}`,
      role: "user",
      content: `🔬 ${query}`,
      timestamp: Date.now(),
    }
    const progressMsgId = `msg-${++msgId}`
    const progressMsg: Message = {
      id: progressMsgId,
      role: "system",
      content: "Agent 研究中...",
      agentResearchProgress: [],
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, userMsg, progressMsg], loading: true }))

    try {
      const model = getModel() || undefined
      const result = await agentResearch(
        query,
        mode,
        model,
        undefined,
        (progress) => {
          set((s) => {
            const msgs = [...s.messages]
            const idx = msgs.findIndex((m) => m.id === progressMsgId)
            if (idx >= 0) {
              const existing = msgs[idx].agentResearchProgress || []
              msgs[idx] = {
                ...msgs[idx],
                agentResearchProgress: [...existing, progress],
                content: `Agent 研究中... ${progress.step} ${progress.status}`,
              }
            }
            return { messages: msgs }
          })
        },
        ac.signal,
      )

      if (ac.signal.aborted) return

      set((s) => {
        const msgs = [...s.messages]
        const idx = msgs.findIndex((m) => m.id === progressMsgId)
        if (idx >= 0) {
          msgs[idx] = {
            ...msgs[idx],
            agentResearchResult: result,
            agentResearchProgress: msgs[idx].agentResearchProgress,
            content: result.summary || "Agent 研究完成",
          }
        }
        return { messages: msgs, loading: false }
      })
    } catch (e: unknown) {
      if (ac.signal.aborted) return
      const errorDetail = e instanceof Error ? e.message : String(e)
      const isAbort = errorDetail === "AbortError" || (e instanceof DOMException && e.name === "AbortError")
      if (isAbort) return
      set((s) => {
        const msgs = [...s.messages]
        const idx = msgs.findIndex((m) => m.id === progressMsgId)
        if (idx >= 0) {
          msgs[idx] = { ...msgs[idx], content: "Agent 研究失败，请重试", errorDetail }
        }
        return { messages: msgs, loading: false }
      })
    } finally {
      if (abortController === ac) abortController = null
    }
  },

  clear: () => set({ messages: [] }),
}))
