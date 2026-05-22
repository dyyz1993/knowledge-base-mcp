import { Send, FlaskConical, Zap, Brain, Cpu } from "lucide-react"
import type { ResearchMode } from "../../services/api"

interface AskInputProps {
  input: string
  loading: boolean
  researchMode: ResearchMode
  onInputChange: (v: string) => void
  onSubmit: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onResearchModeChange: (mode: ResearchMode) => void
  onAgentResearch: () => void
}

export function AskInput({
  input,
  loading,
  researchMode,
  onInputChange,
  onSubmit,
  onKeyDown,
  onResearchModeChange,
  onAgentResearch,
}: AskInputProps) {
  return (
    <div className="border-t border-zinc-800 p-3 shrink-0">
      <div className="flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onInput={(e) => {
            const el = e.currentTarget
            el.style.height = "auto"
            el.style.height = Math.min(el.scrollHeight, 128) + "px"
          }}
          onKeyDown={onKeyDown}
          placeholder="你想了解什么？描述一下你的问题..."
          rows={1}
          className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 max-h-24"
        />
        <div className="shrink-0 flex flex-col gap-1">
          <div className="flex gap-1">
            <button
              onClick={() => onResearchModeChange("quick")}
              className={`px-1.5 py-0.5 rounded text-[9px] ${researchMode === "quick" ? "bg-amber-900/50 text-amber-300" : "bg-zinc-800 text-zinc-500"}`}
              title="快速 (5步)"
            >
              <Zap size={10} />
            </button>
            <button
              onClick={() => onResearchModeChange("standard")}
              className={`px-1.5 py-0.5 rounded text-[9px] ${researchMode === "standard" ? "bg-purple-900/50 text-purple-300" : "bg-zinc-800 text-zinc-500"}`}
              title="标准 (12步)"
            >
              <Brain size={10} />
            </button>
            <button
              onClick={() => onResearchModeChange("deep")}
              className={`px-1.5 py-0.5 rounded text-[9px] ${researchMode === "deep" ? "bg-blue-900/50 text-blue-300" : "bg-zinc-800 text-zinc-500"}`}
              title="深度 (25步)"
            >
              <Cpu size={10} />
            </button>
          </div>
          <button
            onClick={onAgentResearch}
            disabled={!input.trim() || loading}
            className="p-2 rounded-lg bg-purple-700 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-purple-600 transition-colors"
            title="Agent 深度研究"
          >
            <FlaskConical size={16} />
          </button>
        </div>
        <button
          onClick={onSubmit}
          disabled={!input.trim() || loading}
          className="shrink-0 p-2 rounded-lg bg-amber-600 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-500 transition-colors"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
