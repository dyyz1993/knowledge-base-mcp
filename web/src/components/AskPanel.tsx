import { useState, useRef, useEffect } from "react"
import { Sparkles, Trash2, Square } from "lucide-react"
import { useAskStore } from "../stores/ask"
import ModelSelector from "./ModelSelector"
import type { ResearchMode } from "../services/api"
import { AskEmptyState } from "./ask/AskEmptyState"
import { AskInput } from "./ask/AskInput"
import { ResultCard } from "./ask/ResultCard"
import { useTheme } from "../theme"

export default function AskPanel() {
  const { messages, loading, statusText, ask, agentResearchAction, cancel, clear } = useAskStore()
  const { theme } = useTheme()
  const isDark = theme === "dark"
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
      <div className={`flex items-center justify-between px-4 py-2 border-b shrink-0 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-amber-400" />
          <span className="text-sm font-medium">智能问答</span>
          <ModelSelector className="ml-2" />
        </div>
        {messages.length > 0 && (
          <button onClick={clear} aria-label="清空消息" className={`p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors ${isDark ? "hover:bg-zinc-800" : "hover:bg-gray-100 hover:text-gray-700"}`}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && <AskEmptyState onSetInput={setInput} />}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className={`max-w-[95%] md:max-w-[85%] px-3 py-2 rounded-xl border text-sm ${isDark ? "bg-blue-900/30 border-blue-800/50" : "bg-blue-50 border-blue-200 text-gray-800"}`}>
                {msg.content}
              </div>
            ) : (
              <ResultCard msg={msg} expanded={expandedIds.has(msg.id)} onToggle={() => toggleExpand(msg.id)} />
            )}
          </div>
        ))}
        {loading && (
          <div className="flex justify-start items-center gap-2">
            <button
              onClick={cancel}
              aria-label="停止查询"
              className={`px-3 py-2 rounded-xl border text-xs flex items-center gap-2 transition-colors ${isDark ? "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-100 hover:text-gray-800"}`}
            >
              <Square size={12} className="text-red-400" />
              停止查询
            </button>
            {statusText && (
              <span className={`text-[11px] animate-pulse ${isDark ? "text-zinc-500" : "text-gray-500"}`}>{statusText}</span>
            )}
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
