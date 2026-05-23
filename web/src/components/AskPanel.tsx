import { useState, useRef, useEffect } from "react"
import { Sparkles, Trash2, Square } from "lucide-react"
import { useAskStore } from "../stores/ask"
import { useChatStore } from "../stores/chat"
import type { ResearchMode } from "../services/api"
import { AskEmptyState } from "./ask/AskEmptyState"
import { AskInput } from "./ask/AskInput"
import { ResultCard } from "./ask/ResultCard"

export default function AskPanel() {
  const { messages, loading, ask, agentResearchAction, cancel, clear } = useAskStore()
  const { models, currentModel, setModel: setChatModel } = useChatStore()
  const [input, setInput] = useState("")
  const [researchMode, setResearchMode] = useState<ResearchMode>("standard")
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSubmit = () => {
    const q = input.trim()
    if (!q || useAskStore.getState().loading) return
    setInput("")
    ask(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAgentResearch = () => {
    const q = input.trim()
    if (q && !loading) {
      setInput("")
      agentResearchAction(q, researchMode)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-amber-400" />
          <span className="text-sm font-medium">智能问答</span>
          {models.length > 0 && (
            <select
              value={currentModel ? `${currentModel.provider}|${currentModel.id}` : ""}
              aria-label="选择模型"
              onChange={(e) => {
                const val = e.target.value
                if (val) {
                  const idx = val.indexOf("|")
                  setChatModel(val.slice(0, idx), val.slice(idx + 1))
                }
              }}
              className="ml-2 text-[10px] bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-400 focus:outline-none"
            >
              <option value="">默认模型</option>
              {models.map((m) => (
                <option key={`${m.provider}|${m.id}`} value={`${m.provider}|${m.id}`}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          )}
        </div>
        {messages.length > 0 && (
          <button onClick={clear} aria-label="清空消息" className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && <AskEmptyState onSetInput={setInput} />}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-[95%] md:max-w-[85%] px-3 py-2 rounded-xl bg-blue-900/30 border border-blue-800/50 text-sm">
                {msg.content}
              </div>
            ) : (
              <ResultCard msg={msg} expanded={expandedIds.has(msg.id)} onToggle={() => toggleExpand(msg.id)} />
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <button
              onClick={cancel}
              aria-label="停止查询"
              className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-zinc-400 flex items-center gap-2 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            >
              <Square size={12} className="text-red-400" />
              停止查询
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <AskInput
        input={input}
        loading={loading}
        researchMode={researchMode}
        onInputChange={setInput}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        onResearchModeChange={setResearchMode}
        onAgentResearch={handleAgentResearch}
      />
    </div>
  )
}
