import { create } from "zustand"
import { persist } from "zustand/middleware"
import { smartAsk, ingestWebContent, askSearch, askResearch, agentResearch, getResearchStatus, getResearchResult, type AskResult, type PipelineSearchResponse, type ResearchResult, type AgentResearchResult, type AgentResearchProgress, type ResearchMode } from "../services/api"
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
  researchId?: string
  errorDetail?: string
  timestamp: number
}

interface AskState {
  messages: Message[]
  loading: boolean
  statusText: string
  ask: (query: string) => Promise<void>
  search: (query: string) => Promise<void>
  research: (query: string) => Promise<void>
  agentResearchAction: (query: string, mode: ResearchMode) => Promise<void>
  ingest: (url: string, title: string, content: string, tags?: string[]) => Promise<void>
  ingestFromSearch: (query: string, title: string, content: string, url?: string) => Promise<void>
  generateWorkKey: (query: string, results: import("../services/api").PipelineSearchResult[]) => Promise<void>
  reconnectResearch: () => void
  cancel: () => void
  clear: () => void
}

const abortControllers = new Map<string, AbortController>()

function getOrCreateAbortController(actionType: string): AbortController {
  const existing = abortControllers.get(actionType)
  if (existing) return existing
  const controller = new AbortController()
  abortControllers.set(actionType, controller)
  return controller
}

function abortAction(actionType: string): void {
  const controller = abortControllers.get(actionType)
  if (controller) {
    controller.abort()
    abortControllers.delete(actionType)
  }
}

function registerAbortController(actionType: string, ac: AbortController): void {
  abortControllers.set(actionType, ac)
}

function cleanupAbortController(actionType: string, ac: AbortController): void {
  if (abortControllers.get(actionType) === ac) {
    abortControllers.delete(actionType)
  }
}

function getModel() {
  return useChatStore.getState().currentModel
}

export const useAskStore = create<AskState>()(
  persist(
    (set, get) => ({
      messages: [],
      loading: false,
      statusText: "",

      cancel: () => {
        for (const [key] of abortControllers) {
          abortAction(key)
        }
        set({ loading: false, statusText: "" })
      },

      ask: async (query) => {
        abortAction("ask")
        const ac = getOrCreateAbortController("ask")
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: query,
          timestamp: Date.now(),
        }
        set((s) => ({ messages: [...s.messages, userMsg], loading: true, statusText: "正在搜索知识库..." }))

        try {
          const result = await smartAsk(query, ac.signal)
          if (ac.signal.aborted) return
          if (result.error) {
            const errorMsg: Message = {
              id: crypto.randomUUID(),
              role: "system",
              content: result.hint || "查询失败",
              result,
              errorDetail: result.error,
              timestamp: Date.now(),
            }
            set((s) => ({ messages: [...s.messages, errorMsg], loading: false, statusText: "" }))
            return
          }
          if (result.from_kb) {
            const systemMsg: Message = {
              id: crypto.randomUUID(),
              role: "system",
              content: result.title || "知识库命中",
              result,
              timestamp: Date.now(),
            }
            set((s) => ({ messages: [...s.messages, systemMsg], loading: false, statusText: "" }))
          } else {
            set({ statusText: "知识库未找到，正在联网搜索..." })
            try {
              const searchResult = await askSearch(query, getModel() || undefined, ac.signal)
              if (ac.signal.aborted) return
              set({ statusText: "正在分析结果..." })
              const systemMsg: Message = {
                id: crypto.randomUUID(),
                role: "system",
                content: searchResult.hint,
                result,
                searchResult,
                timestamp: Date.now(),
              }
              set((s) => ({ messages: [...s.messages, systemMsg], loading: false, statusText: "" }))
            } catch {
              if (ac.signal.aborted) return
              const systemMsg: Message = {
                id: crypto.randomUUID(),
                role: "system",
                content: result.hint || "未命中知识库",
                result,
                timestamp: Date.now(),
              }
              set((s) => ({ messages: [...s.messages, systemMsg], loading: false, statusText: "" }))
            }
          }
        } catch (e: unknown) {
          if (ac.signal.aborted) return
          const errorDetail = e instanceof Error ? e.message : String(e)
          const isAbort = errorDetail === "AbortError" || (e instanceof DOMException && e.name === "AbortError")
          if (isAbort) return
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            role: "system",
            content: "查询失败，请重试",
            errorDetail,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, errorMsg], loading: false, statusText: "" }))
        } finally {
          cleanupAbortController("ask", ac)
        }
      },

      search: async (query) => {
        abortAction("search")
        const ac = getOrCreateAbortController("search")
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: `🔍 ${query}`,
          timestamp: Date.now(),
        }
        set((s) => ({ messages: [...s.messages, userMsg], loading: true, statusText: "正在搜索..." }))

        try {
          const searchResult = await askSearch(query, getModel() || undefined, ac.signal)
          if (ac.signal.aborted) return
          const systemMsg: Message = {
            id: crypto.randomUUID(),
            role: "system",
            content: searchResult.hint,
            searchResult,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, systemMsg], loading: false, statusText: "" }))
        } catch (e: unknown) {
          if (ac.signal.aborted) return
          const errorDetail = e instanceof Error ? e.message : String(e)
          const isAbort = errorDetail === "AbortError" || (e instanceof DOMException && e.name === "AbortError")
          if (isAbort) return
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            role: "system",
            content: "搜索失败，请重试",
            errorDetail,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, errorMsg], loading: false, statusText: "" }))
        } finally {
          cleanupAbortController("search", ac)
        }
      },

      research: async (query) => {
        abortAction("research")
        const ac = getOrCreateAbortController("research")
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: `🔬 ${query}`,
          timestamp: Date.now(),
        }
        set((s) => ({ messages: [...s.messages, userMsg], loading: true, statusText: "正在深度研究..." }))

        try {
          const researchResult = await askResearch(query, getModel() || undefined, ac.signal)
          if (ac.signal.aborted) return
          const systemMsg: Message = {
            id: crypto.randomUUID(),
            role: "system",
            content: researchResult.summary || "深度研究完成",
            researchResult,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, systemMsg], loading: false, statusText: "" }))
        } catch (e: unknown) {
          if (ac.signal.aborted) return
          const errorDetail = e instanceof Error ? e.message : String(e)
          const isAbort = errorDetail === "AbortError" || (e instanceof DOMException && e.name === "AbortError")
          if (isAbort) return
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            role: "system",
            content: "深度研究失败，请重试",
            errorDetail,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, errorMsg], loading: false, statusText: "" }))
        } finally {
          cleanupAbortController("research", ac)
        }
      },

      ingest: async (url, title, content, tags) => {
        try {
          const result = await ingestWebContent({ url, title, content, tags })
          const msg: Message = {
            id: crypto.randomUUID(),
            role: "system",
            content: `已存储: ${result.title} (id: ${result.id})`,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, msg] }))
        } catch {
          const msg: Message = {
            id: crypto.randomUUID(),
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
            id: crypto.randomUUID(),
            role: "system",
            content: `已沉淀: ${result.title} (id: ${result.id})`,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, msg] }))
        } catch {
          const msg: Message = {
            id: crypto.randomUUID(),
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
            id: crypto.randomUUID(),
            role: "system",
            content: `Work Key 已生成: ${result.title} (id: ${result.id})`,
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, msg] }))
        } catch {
          const msg: Message = {
            id: crypto.randomUUID(),
            role: "system",
            content: "Work Key 生成失败",
            timestamp: Date.now(),
          }
          set((s) => ({ messages: [...s.messages, msg] }))
        }
      },

      agentResearchAction: async (query, mode) => {
        abortAction("agentResearch")
        const ac = getOrCreateAbortController("agentResearch")
        const userMsg: Message = {
          id: crypto.randomUUID(),
          role: "user",
          content: `🔬 ${query}`,
          timestamp: Date.now(),
        }
        const progressMsgId = crypto.randomUUID()
        const progressMsg: Message = {
          id: progressMsgId,
          role: "system",
          content: "Agent 研究中...",
          agentResearchProgress: [],
          timestamp: Date.now(),
        }
        set((s) => ({ messages: [...s.messages, userMsg, progressMsg], loading: true, statusText: "Agent 研究中..." }))

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
                researchId: result.researchId,
                agentResearchResult: result,
                agentResearchProgress: msgs[idx].agentResearchProgress,
                content: result.summary || "Agent 研究完成",
              }
            }
            return { messages: msgs, loading: false, statusText: "" }
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
            return { messages: msgs, loading: false, statusText: "" }
          })
        } finally {
          cleanupAbortController("agentResearch", ac)
        }
      },

      reconnectResearch: () => {
        const { messages } = get()
        for (const msg of messages) {
          if (msg.agentResearchProgress && !msg.agentResearchResult && msg.researchId) {
            const researchId = msg.researchId
            const msgId = msg.id
            getResearchStatus(researchId).then((status) => {
              if (status.status === "completed") {
                getResearchResult(researchId).then((result) => {
                  set((s) => {
                    const msgs = [...s.messages]
                    const idx = msgs.findIndex((m) => m.id === msgId)
                    if (idx >= 0) {
                      msgs[idx] = {
                        ...msgs[idx],
                        agentResearchResult: result,
                        content: result.summary || "Agent 研究完成",
                      }
                    }
                    return { messages: msgs }
                  })
                }).catch(() => {})
              } else if (status.status === "failed") {
                set((s) => {
                  const msgs = [...s.messages]
                  const idx = msgs.findIndex((m) => m.id === msgId)
                  if (idx >= 0) {
                    msgs[idx] = { ...msgs[idx], content: "Agent 研究失败", errorDetail: "服务端报告研究已失败" }
                  }
                  return { messages: msgs }
                })
              } else if (status.status === "running") {
                set((s) => {
                  const msgs = [...s.messages]
                  const idx = msgs.findIndex((m) => m.id === msgId)
                  if (idx >= 0) {
                    msgs[idx] = {
                      ...msgs[idx],
                      agentResearchProgress: status.progress,
                      content: `Agent 研究中... (已恢复)`,
                    }
                  }
                  return { messages: msgs, loading: true, statusText: "Agent 研究中... (已恢复连接)" }
                })
              }
            }).catch(() => {})
            break
          }
        }
      },

      clear: () => set({ messages: [], statusText: "" }),
    }),
    {
      name: "kb-ask-store",
      partialize: (state) => ({ messages: state.messages }),
    }
  )
)
