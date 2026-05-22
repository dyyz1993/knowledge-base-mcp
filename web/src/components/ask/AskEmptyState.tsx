import { Send, Sparkles, FlaskConical, Zap, Brain, Cpu } from "lucide-react"
import type { ResearchMode } from "../../services/api"

interface AskEmptyStateProps {
  onSetInput: (v: string) => void
}

export function AskEmptyState({ onSetInput }: AskEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4 px-4">
      <Sparkles size={36} className="text-zinc-600" />
      <div className="text-center max-w-sm">
        <p className="text-sm font-medium text-zinc-300 mb-1">智能问答</p>
        <p className="text-xs text-zinc-500 leading-relaxed">
          输入问题后先搜索知识库，命中则直接返回答案；未命中则自动联网搜索并引导存储为新知识。
        </p>
      </div>
      <div className="w-full max-w-sm space-y-2.5 mt-1">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            <Send size={12} className="text-amber-400" />
            <span className="text-[11px] font-medium text-amber-400">普通查询</span>
            <span className="text-[9px] text-zinc-600 ml-auto">琥珀色按钮</span>
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">先搜知识库 → 未命中自动联网搜索 → 可一键存入知识库</p>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
          <div className="flex items-center gap-2 mb-1.5">
            <FlaskConical size={12} className="text-purple-400" />
            <span className="text-[11px] font-medium text-purple-400">Agent 深度研究</span>
            <span className="text-[9px] text-zinc-600 ml-auto">紫色按钮</span>
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">多步骤自动研究，支持 sitemap/GitHub 深度分析，生成结构化报告</p>
          <div className="flex gap-1.5 mt-1.5">
            <span className="flex items-center gap-0.5 text-[9px] text-zinc-600"><Zap size={8} /> 快速</span>
            <span className="text-[9px] text-zinc-700">·</span>
            <span className="flex items-center gap-0.5 text-[9px] text-zinc-600"><Brain size={8} /> 标准</span>
            <span className="text-[9px] text-zinc-700">·</span>
            <span className="flex items-center gap-0.5 text-[9px] text-zinc-600"><Cpu size={8} /> 深度</span>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800/50 bg-zinc-950/50 px-3 py-2">
          <p className="text-[10px] text-zinc-600 mb-1">试试这些查询：</p>
          <div className="space-y-0.5">
            <p className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => onSetInput("如何配置 semantic search？")}>"如何配置 semantic search？"</p>
            <p className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => onSetInput("Remotion 视频渲染的最佳实践")}>"Remotion 视频渲染的最佳实践"</p>
          </div>
        </div>
      </div>
    </div>
  )
}
