import { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink, FlaskConical, CheckCircle2, XCircle, Circle, Loader, AlertCircle } from "lucide-react"
import type { AgentResearchResult, AgentResearchProgress } from "../../services/api"

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
    <div className="max-w-[85%] w-full rounded-xl bg-zinc-900 border border-zinc-800 border-l-2 border-l-violet-500 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-800">
        <FlaskConical size={13} className="text-violet-400" />
        <span className="text-xs font-medium text-violet-400">Agent 研究</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${modeColorClasses[modeColor] || modeColorClasses.standard}`}>{modeLabel}</span>
        {isComplete && (
          <span className="text-[10px] text-zinc-500">
            {result.totalSteps} 步 · {(result.durationMs / 1000).toFixed(1)}s · 质量 {result.finalQualityScore}/10
          </span>
        )}
      </div>

      <div className="px-3 py-2">
        <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-2">
          <div
            className="bg-violet-500 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {uniqueSteps.map((s) => (
            <span
              key={s.step}
              className="flex items-center gap-0.5 text-[9px]"
              title={`${STEP_LABELS[s.step] || s.step}: ${s.status}`}
            >
              {s.status === "done" && <CheckCircle2 size={9} className="text-emerald-400" />}
              {s.status === "running" && <Loader size={9} className="text-violet-400 animate-spin" />}
              {s.status === "failed" && <XCircle size={9} className="text-red-400" />}
              {s.status === "skipped" && <Circle size={9} className="text-zinc-600" />}
              <span className={s.status === "done" ? "text-zinc-400" : s.status === "running" ? "text-violet-300" : "text-zinc-600"}>
                {STEP_LABELS[s.step] || s.step}
              </span>
            </span>
          ))}
          {!isComplete && steps.length > 0 && steps[steps.length - 1].status === "running" && (
            <span className="flex items-center gap-0.5 text-[9px] text-zinc-500">
              <Loader size={9} className="animate-spin" />
              进行中...
            </span>
          )}
        </div>
      </div>

      {!isComplete && errorDetail && (
        <div className="px-3 py-2 border-t border-zinc-800">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertCircle size={11} className="text-red-400" />
            <span className="text-[10px] text-red-300">研究失败</span>
          </div>
          <button onClick={() => setShowError(!showError)} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300">
            {showError ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            查看详情
          </button>
          {showError && (
            <div className="mt-1 p-2 rounded bg-zinc-950 text-[10px] text-zinc-400 whitespace-pre-wrap break-all">{errorDetail}</div>
          )}
        </div>
      )}

      {isComplete && result.summary && (
        <div className="px-3 py-3 border-t border-zinc-800">
          {result.summaryFallback && (
            <div className="mb-2 px-2 py-1 rounded bg-amber-900/30 border border-amber-700/30 text-[10px] text-amber-400">
              LLM 总结失败，以下为深读内容摘要（仅供参考）
            </div>
          )}
          <div className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">{result.summary}</div>

          {result.outline && (
            <div className="mt-2">
              <button onClick={() => setShowOutline(!showOutline)} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300">
                {showOutline ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                大纲
              </button>
              {showOutline && (
                <div className="mt-1 p-2 rounded bg-zinc-950 text-[10px] text-zinc-400 whitespace-pre-wrap">{result.outline}</div>
              )}
            </div>
          )}

          {result.sources.length > 0 && (
            <div className="mt-2 pt-2 border-t border-zinc-800">
              <button onClick={() => setShowSources(!showSources)} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300">
                {showSources ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                参考来源 ({result.sources.length})
              </button>
              {showSources && (
                <div className="mt-1 space-y-0.5">
                  {result.sources.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-500">[{i + 1}]</span>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 truncate">{s.title}</a>
                      <ExternalLink size={8} className="text-zinc-600 shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isComplete && result.phaseLog.length > 0 && (
        <div className="px-3 py-1.5 border-t border-zinc-800">
          <p className="text-[9px] text-zinc-600">{result.phaseLog.join(" → ")}</p>
        </div>
      )}
    </div>
  )
}
