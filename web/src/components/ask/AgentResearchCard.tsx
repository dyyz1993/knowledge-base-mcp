import { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink, FlaskConical, CheckCircle2, XCircle, Circle, Loader, AlertCircle } from "lucide-react"
import type { AgentResearchResult, AgentResearchProgress } from "../../services/api"
import { useTheme } from "../../theme"

const STEP_LABELS: Record<string, string> = {
  analyze_query: "分析查询",
  search: "搜索",
  filter_results: "筛选结果",
  evaluate: "评估选取",
  deep_read: "深度阅读",
  check_sitemap: "检查站点地图",
  follow_paths: "跟进路径",
  evaluate_depth: "质量评估",
  check_github: "检查 GitHub",
  clone_index: "克隆索引",
  code_search: "代码搜索",
  synthesize: "总结生成",
}

export function AgentResearchCard({ result, progress, errorDetail }: {
  result?: AgentResearchResult
  progress?: AgentResearchProgress[]
  errorDetail?: string
}) {
  const [showSources, setShowSources] = useState(false)
  const [showOutline, setShowOutline] = useState(false)
  const [showError, setShowError] = useState(false)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const steps = progress || []
  const latestPerStep = new Map<string, AgentResearchProgress>()
  for (const s of steps) {
    latestPerStep.set(s.step, s)
  }
  const uniqueSteps = Array.from(latestPerStep.values()).sort((a, b) => a.timestamp - b.timestamp)

  const isComplete = !!result
  const budget = steps.length > 0 ? steps[steps.length - 1].budget : null
  const pct = budget ? Math.round((budget.usedCost / budget.maxCost) * 100) : 0
  const modeLabel = budget?.mode === "quick" ? "快速" : budget?.mode === "deep" ? "深度" : "标准"
  const modeColorClasses: Record<string, string> = {
    quick: "bg-amber-900/30 text-amber-400",
    standard: "bg-purple-900/30 text-purple-400",
    deep: "bg-blue-900/30 text-blue-400",
  }
  const modeColor = budget?.mode || "standard"

  return (
    <div className={`max-w-[85%] w-full rounded-xl border border-l-2 border-l-violet-500 overflow-hidden ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-gray-200"}`}>
      <div className={`px-3 py-2 flex items-center gap-2 border-b ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <FlaskConical size={13} className="text-violet-400" />
        <span className="text-xs font-medium text-violet-400">Agent 研究</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${modeColorClasses[modeColor] || modeColorClasses.standard}`}>{modeLabel}</span>
        {isComplete && (
          <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
            {result.totalSteps} 步 · {(result.durationMs / 1000).toFixed(1)}s · 质量 {result.finalQualityScore}/10
          </span>
        )}
      </div>

      <div className="px-3 py-2">
        {isComplete && (
          <div className={`w-full rounded-full h-1.5 mb-3 ${isDark ? "bg-zinc-800" : "bg-gray-200"}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`研究进度 ${pct}%`}>
            <div
              className="bg-violet-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        <div className="relative pl-8">
          <div className={`absolute left-3 top-0 bottom-0 w-0.5 rounded-full ${isDark ? "bg-zinc-700" : "bg-gray-200"}`} />
          {uniqueSteps.map((s, idx) => {
            return (
              <div key={s.step} className="relative pb-3 last:pb-0">
                <div className={`absolute left-3 w-1.5 h-1.5 rounded-full border-2 ${isDark ? "border-zinc-900" : "border-white"} ${
                  s.status === "done" ? "bg-emerald-400" :
                  s.status === "running" ? "bg-violet-400 animate-pulse" :
                  s.status === "failed" ? "bg-red-400" :
                  "bg-zinc-400"
                }`} style={{ top: "0.35rem" }} />
                <div className="flex items-center justify-between gap-3 ml-4">
                  <div className="flex items-center gap-2">
                    {s.status === "done" && <CheckCircle2 size={14} className="text-emerald-400" />}
                    {s.status === "running" && <Loader size={14} className="text-violet-400 animate-spin" />}
                    {s.status === "failed" && <XCircle size={14} className="text-red-400" />}
                    {s.status === "skipped" && <Circle size={14} className={isDark ? "text-zinc-600" : "text-gray-400"} />}
                    <span className={`text-xs ${s.status === "done" ? (isDark ? "text-zinc-200" : "text-gray-800") : s.status === "running" ? (isDark ? "text-violet-300" : "text-violet-600") : (isDark ? "text-zinc-500" : "text-gray-400")}`}>
                      {STEP_LABELS[s.step] || s.step}
                    </span>
                  </div>
                  <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
                    {s.status === "done" ? "完成" : s.status === "running" ? "进行中..." : s.status === "failed" ? "失败" : s.status === "skipped" ? "已跳过" : ""}
                  </span>
                </div>
              </div>
            )
          })}
          {!isComplete && steps.length > 0 && steps[steps.length - 1].status === "running" && (
            <div className="flex items-center gap-2 ml-4 text-[10px] text-violet-400">
              <Loader size={10} className="animate-spin" />
              进行中...
            </div>
          )}
        </div>
      </div>

      {!isComplete && errorDetail && (
        <div className={`px-3 py-2 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle size={11} className="text-red-400" />
            <span className={`text-[10px] ${isDark ? "text-red-300" : "text-red-600"}`}>研究失败</span>
          </div>
          <button onClick={() => setShowError(!showError)} aria-expanded={showError} className={`flex items-center gap-1 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
            {showError ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            查看详情
          </button>
          {showError && (
            <div className={`mt-1 p-2 rounded text-[10px] whitespace-pre-wrap break-all ${isDark ? "bg-zinc-950 text-zinc-400" : "bg-gray-100 text-gray-600"}`}>{errorDetail}</div>
          )}
        </div>
      )}

      {isComplete && result.summary && (
        <div className={`px-3 py-3 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          {result.summaryFallback && (
            <div className="mb-2 px-2 py-1 rounded bg-amber-900/30 border border-amber-700/30 text-[10px] text-amber-400">
              LLM 总结失败，以下为深读内容摘要（仅供参考）
            </div>
          )}
          <div className={`text-sm whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto ${isDark ? "text-zinc-200" : "text-gray-800"}`}>{result.summary}</div>

          {result.outline && (
            <div className="mt-2">
              <button onClick={() => setShowOutline(!showOutline)} aria-expanded={showOutline} className={`flex items-center gap-1 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
                {showOutline ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                大纲
              </button>
              {showOutline && (
                <div className={`mt-1 p-2 rounded text-[10px] whitespace-pre-wrap ${isDark ? "bg-zinc-950 text-zinc-400" : "bg-gray-100 text-gray-600"}`}>{result.outline}</div>
              )}
            </div>
          )}

          {result.sources.length > 0 && (
            <div className={`mt-2 pt-2 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
              <button onClick={() => setShowSources(!showSources)} aria-expanded={showSources} className={`flex items-center gap-1 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
                {showSources ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                参考来源 ({result.sources.length})
              </button>
              {showSources && (
                <div className="mt-1 space-y-0.5">
                  {result.sources.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>[{i + 1}]</span>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 truncate">{s.title}</a>
                      <ExternalLink size={8} className={`${isDark ? "text-zinc-600" : "text-gray-400"} shrink-0`} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isComplete && result.phaseLog.length > 0 && (
        <div className={`px-3 py-1.5 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          <p className={`text-[9px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>{result.phaseLog.join(" → ")}</p>
        </div>
      )}
    </div>
  )
}
