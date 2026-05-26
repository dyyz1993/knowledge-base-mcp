import { Send, Sparkles, FlaskConical, Zap, Brain, Cpu } from "lucide-react"
import type { ResearchMode } from "../../services/api"
import { useTheme } from "../../theme"

interface AskEmptyStateProps {
  onSetInput: (v: string) => void
}

export function AskEmptyState({ onSetInput }: AskEmptyStateProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"

  return (
    <div className={`flex flex-col items-center justify-center h-full gap-4 px-4 ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
      <Sparkles size={36} className={isDark ? "text-zinc-600" : "text-gray-400"} />
      <div className="text-center max-w-sm">
        <p className={`text-sm font-medium mb-1 ${isDark ? "text-zinc-300" : "text-gray-700"}`}>智能问答</p>
        <p className={`text-xs leading-relaxed ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
          输入问题后先搜索知识库，命中则直接返回答案；未命中则自动联网搜索并引导存储为新知识。
        </p>
      </div>
      <div className="w-full max-w-sm space-y-2.5 mt-1">
        <div className={`rounded-lg border px-3 py-2 ${isDark ? "border-zinc-800 bg-zinc-900/50" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <Send size={12} className="text-amber-400" />
            <span className="text-[11px] font-medium text-amber-400">普通查询</span>
            <span className={`text-[9px] ml-auto ${isDark ? "text-zinc-600" : "text-gray-400"}`}>琥珀色按钮</span>
          </div>
          <p className={`text-[10px] leading-relaxed ${isDark ? "text-zinc-500" : "text-gray-500"}`}>先搜知识库 → 未命中自动联网搜索 → 可一键存入知识库</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${isDark ? "border-zinc-800 bg-zinc-900/50" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center gap-2 mb-1.5">
            <FlaskConical size={12} className="text-purple-400" />
            <span className="text-[11px] font-medium text-purple-400">Agent 深度研究</span>
            <span className={`text-[9px] ml-auto ${isDark ? "text-zinc-600" : "text-gray-400"}`}>紫色按钮</span>
          </div>
          <p className={`text-[10px] leading-relaxed ${isDark ? "text-zinc-500" : "text-gray-500"}`}>多步骤自动研究，支持 sitemap/GitHub 深度分析，生成结构化报告</p>
          <div className="flex gap-1.5 mt-1.5">
            <span className={`flex items-center gap-0.5 text-[9px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}><Zap size={8} /> 快速</span>
            <span className={`text-[9px] ${isDark ? "text-zinc-700" : "text-gray-300"}`}>·</span>
            <span className={`flex items-center gap-0.5 text-[9px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}><Brain size={8} /> 标准</span>
            <span className={`text-[9px] ${isDark ? "text-zinc-700" : "text-gray-300"}`}>·</span>
            <span className={`flex items-center gap-0.5 text-[9px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}><Cpu size={8} /> 深度</span>
          </div>
        </div>
        <div className={`rounded-lg border px-3 py-2 ${isDark ? "border-zinc-800/50 bg-zinc-950/50" : "border-gray-200 bg-gray-50"}`}>
          <p className={`text-[10px] mb-1 ${isDark ? "text-zinc-600" : "text-gray-500"}`}>试试这些查询：</p>
          <div className="space-y-0.5">
            <p className={`text-[10px] cursor-pointer transition-colors ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`} role="button" tabIndex={0} onClick={() => onSetInput("如何配置 semantic search？")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSetInput("如何配置 semantic search？") }}>"如何配置 semantic search？"</p>
            <p className={`text-[10px] cursor-pointer transition-colors ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`} role="button" tabIndex={0} onClick={() => onSetInput("Remotion 视频渲染的最佳实践")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSetInput("Remotion 视频渲染的最佳实践") }}>"Remotion 视频渲染的最佳实践"</p>
          </div>
        </div>
      </div>
    </div>
  )
}
