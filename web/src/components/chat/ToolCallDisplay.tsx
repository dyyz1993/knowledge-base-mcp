import { useState } from "react"
import { ChevronDown, ChevronRight, Wrench, Loader2, CheckCircle2, XCircle, SkipForward, Play, Search } from "lucide-react"
import { useTheme } from "../../theme"

interface ToolCallBlockProps {
  name: string
  args: string
  result: string
}

export function ToolCallBlock({ name, args, result }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false)
  const { theme } = useTheme()
  const isDark = theme === "dark"
  return (
    <div className={`my-1.5 rounded-lg border text-sm ${isDark ? "border-zinc-800 bg-zinc-900/50" : "border-gray-200 bg-gray-50"}`}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-3 py-2 transition-colors ${isDark ? "text-zinc-400 hover:text-zinc-200" : "text-gray-500 hover:text-gray-800"}`}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={13} />
        <span className={`font-medium ${isDark ? "text-zinc-300" : "text-gray-700"}`}>{name}</span>
        {!result && <Loader2 size={12} className={`animate-spin ${isDark ? "text-zinc-500" : "text-gray-400"}`} />}
      </button>
      {open && (
        <div className={`border-t px-3 py-2 text-xs space-y-2 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          {args && (
            <div>
              <span className={isDark ? "text-zinc-500" : "text-gray-500"}>Args:</span>
              <pre className={`mt-1 rounded p-2 overflow-x-auto ${isDark ? "bg-zinc-950 text-zinc-300" : "bg-gray-100 text-gray-700"}`}>{args}</pre>
            </div>
          )}
          {result && (
            <div>
              <span className={isDark ? "text-zinc-500" : "text-gray-500"}>Result:</span>
              <pre className={`mt-1 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto ${isDark ? "bg-zinc-950 text-zinc-300" : "bg-gray-100 text-gray-700"}`}>{result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STEP_LABELS: Record<string, string> = {
  analyze_query: "分析查询",
  search: "搜索",
  filter_results: "过滤结果",
  evaluate: "评估 URL",
  deep_read: "深度阅读",
  check_sitemap: "Sitemap",
  check_github: "GitHub",
  follow_paths: "路径发现",
  evaluate_depth: "质量评估",
  synthesize: "总结生成",
  clone_index: "代码索引",
  code_search: "代码搜索",
}

interface ResearchStep {
  step: string
  status: string
  budget?: { usedSteps: number; maxSteps: number }
}

interface ResearchProgressBarProps {
  progress: ResearchStep[]
}

export function ResearchProgressBar({ progress }: ResearchProgressBarProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  if (progress.length === 0) return null

  const budgetInfo = progress.find(p => p.budget)?.budget
  const currentStep = progress.find(p => p.status === "running")
  const doneSteps = progress.filter(p => p.status === "done").length
  const totalSteps = progress.length

  return (
    <div className={`mt-1.5 rounded-lg border px-3 py-2 text-xs space-y-1.5 ${isDark ? "border-blue-500/20 bg-blue-950/30" : "border-blue-300 bg-blue-50"}`} role="status" aria-live="polite" aria-label="深度研究进度">
      <div className="flex items-center justify-between text-blue-500">
        <span className="flex items-center gap-1.5 font-medium">
          <Search size={12} className="animate-pulse" />
          🔬 深度研究进行中
          {currentStep && (
            <span className={`${isDark ? "text-blue-300" : "text-blue-600"} font-normal`}>
              — {STEP_LABELS[currentStep.step] || currentStep.step}
            </span>
          )}
        </span>
        {budgetInfo && (
          <span className={isDark ? "text-zinc-500" : "text-gray-500"}>
            {budgetInfo.usedSteps}/{budgetInfo.maxSteps} 步
          </span>
        )}
      </div>
      {totalSteps > 0 && (
        <div className={`w-full h-1 rounded-full overflow-hidden ${isDark ? "bg-zinc-800" : "bg-gray-200"}`} role="progressbar" aria-valuenow={Math.min(100, (doneSteps / totalSteps) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`研究进度 ${doneSteps}/${totalSteps}`}>
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, (doneSteps / totalSteps) * 100)}%` }}
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {progress.map((p) => (
          <span
            key={p.step}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] ${
              p.status === "done"
                ? (isDark ? "bg-green-900/40 text-green-400" : "bg-green-100 text-green-600")
                : p.status === "running"
                ? (isDark ? "bg-blue-900/40 text-blue-300 animate-pulse" : "bg-blue-100 text-blue-600 animate-pulse")
                : p.status === "failed"
                ? (isDark ? "bg-red-900/40 text-red-400" : "bg-red-100 text-red-600")
                : p.status === "skipped"
                ? (isDark ? "bg-zinc-800/40 text-zinc-600" : "bg-gray-100 text-gray-400")
                : (isDark ? "bg-zinc-800/40 text-zinc-500" : "bg-gray-100 text-gray-500")
            }`}
          >
            {p.status === "done" && <CheckCircle2 size={8} />}
            {p.status === "running" && <Play size={8} />}
            {p.status === "failed" && <XCircle size={8} />}
            {p.status === "skipped" && <SkipForward size={8} />}
            {STEP_LABELS[p.step] || p.step}
          </span>
        ))}
      </div>
    </div>
  )
}
