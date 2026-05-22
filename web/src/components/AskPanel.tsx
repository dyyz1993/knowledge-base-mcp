import { useState, useRef, useEffect } from "react"
import { Send, Sparkles, Database, Globe, Save, ChevronDown, ChevronUp, Trash2, ExternalLink, Loader2, Search, BookOpen, Key, FlaskConical, CheckCircle2, XCircle, Circle, Loader, Zap, Brain, Cpu, Square, AlertCircle } from "lucide-react"
import { useAskStore } from "../stores/ask"
import { useChatStore } from "../stores/chat"
import { webRead, askDeepRead } from "../services/api"
import type { AskResult, WebSearchItem, PipelineSearchResponse, PipelineSearchResult, ResearchResult, AgentResearchResult, AgentResearchProgress, ResearchMode } from "../services/api"

export default function AskPanel() {
  const { messages, loading, ask, research, agentResearchAction, cancel, clear } = useAskStore()
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-amber-400" />
          <span className="text-sm font-medium">智能问答</span>
          {models.length > 0 && (
            <select
              value={currentModel ? `${currentModel.provider}|${currentModel.id}` : ""}
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
          <button onClick={clear} className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800">
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
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
                  <p className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => setInput("如何配置 semantic search？")}>"如何配置 semantic search？"</p>
                  <p className="text-[10px] text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors" onClick={() => setInput("Remotion 视频渲染的最佳实践")}>"Remotion 视频渲染的最佳实践"</p>
                </div>
              </div>
            </div>
          </div>
        )}
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
              className="px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-700 text-xs text-zinc-400 flex items-center gap-2 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            >
              <Square size={12} className="text-red-400" />
              停止查询
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = "auto"
              el.style.height = Math.min(el.scrollHeight, 128) + "px"
            }}
            onKeyDown={handleKeyDown}
            placeholder="你想了解什么？描述一下你的问题..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 max-h-24"
          />
          <div className="shrink-0 flex flex-col gap-1">
            <div className="flex gap-1">
              <button
                onClick={() => setResearchMode("quick")}
                className={`px-1.5 py-0.5 rounded text-[9px] ${researchMode === "quick" ? "bg-amber-900/50 text-amber-300" : "bg-zinc-800 text-zinc-500"}`}
                title="快速 (5步)"
              >
                <Zap size={10} />
              </button>
              <button
                onClick={() => setResearchMode("standard")}
                className={`px-1.5 py-0.5 rounded text-[9px] ${researchMode === "standard" ? "bg-purple-900/50 text-purple-300" : "bg-zinc-800 text-zinc-500"}`}
                title="标准 (12步)"
              >
                <Brain size={10} />
              </button>
              <button
                onClick={() => setResearchMode("deep")}
                className={`px-1.5 py-0.5 rounded text-[9px] ${researchMode === "deep" ? "bg-blue-900/50 text-blue-300" : "bg-zinc-800 text-zinc-500"}`}
                title="深度 (25步)"
              >
                <Cpu size={10} />
              </button>
            </div>
            <button
              onClick={() => {
                const q = input.trim()
                if (q && !loading) { setInput(""); agentResearchAction(q, researchMode) }
              }}
              disabled={!input.trim() || loading}
              className="p-2 rounded-lg bg-purple-700 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-purple-600 transition-colors"
              title="Agent 深度研究"
            >
              <FlaskConical size={16} />
            </button>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || loading}
            className="shrink-0 p-2 rounded-lg bg-amber-600 text-white disabled:opacity-30 disabled:cursor-not-allowed hover:bg-amber-500 transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

function ResultCard({ msg, expanded, onToggle }: {
  msg: { id: string; content: string; result?: AskResult; searchResult?: PipelineSearchResponse; researchResult?: ResearchResult; agentResearchResult?: AgentResearchResult; agentResearchProgress?: AgentResearchProgress[]; errorDetail?: string }
  expanded: boolean
  onToggle: () => void
}) {
  const [showError, setShowError] = useState(false)
  const result = msg.result

  if (msg.errorDetail && !result && !msg.searchResult && !msg.researchResult && !msg.agentResearchResult) {
    return (
      <div className="max-w-[95%] md:max-w-[85%] rounded-xl bg-zinc-900 border border-zinc-800 border-l-2 border-l-red-500 overflow-hidden">
        <div className="px-3 py-2 flex items-center gap-2">
          <AlertCircle size={13} className="text-red-400" />
          <span className="text-sm text-red-300">{msg.content}</span>
        </div>
        <div className="px-3 pb-2">
          <button onClick={() => setShowError(!showError)} className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300">
            {showError ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            查看详情
          </button>
          {showError && (
            <div className="mt-1 p-2 rounded bg-zinc-950 text-[10px] text-zinc-400 whitespace-pre-wrap break-all">{msg.errorDetail}</div>
          )}
        </div>
      </div>
    )
  }

  if (msg.agentResearchResult || (msg.agentResearchProgress && msg.agentResearchProgress.length > 0)) {
    return <AgentResearchCard result={msg.agentResearchResult} progress={msg.agentResearchProgress} errorDetail={msg.errorDetail} />
  }

  if (msg.researchResult) {
    return <ResearchResultCard researchResult={msg.researchResult} />
  }

  if (msg.searchResult) {
    return (
      <PipelineResultsCard
        searchResult={msg.searchResult}
        onIngest={(query, title, content, url) =>
          useAskStore.getState().ingestFromSearch(query, title, content, url)
        }
        onGenerateWorkKey={(query, results) => useAskStore.getState().generateWorkKey(query, results)}
      />
    )
  }

  if (!result) {
    return <div className="max-w-[95%] md:max-w-[85%] px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-sm">{msg.content}</div>
  }

  if (result.from_kb) {
    return (
      <div className="max-w-[95%] md:max-w-[85%] w-full rounded-xl bg-zinc-900 border border-zinc-800 border-l-2 border-l-emerald-500 overflow-hidden">
        <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-800">
          <Database size={13} className="text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">知识库命中</span>
          {result.score != null && <span className="text-[10px] text-zinc-500 ml-auto">相似度: {result.score}</span>}
        </div>
        <div className="px-3 py-2">
          <p className="text-sm font-medium text-zinc-200">{result.title}</p>
          {result.content && (
            <div className="mt-2">
              <div
                className={`text-xs text-zinc-400 whitespace-pre-wrap ${!expanded ? "line-clamp-4" : ""}`}
              >
                {result.content}
              </div>
              {result.content.length > 200 && (
                <button onClick={onToggle} className="flex items-center gap-1 mt-1 text-[10px] text-zinc-500 hover:text-zinc-300">
                  {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  {expanded ? "收起" : "展开"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-[95%] md:max-w-[85%] w-full rounded-xl bg-zinc-900 border border-zinc-800 border-l-2 border-l-amber-500 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-800">
        <Globe size={13} className="text-amber-400" />
        <span className="text-xs font-medium text-amber-400">未命中知识库</span>
        {result.recurring && (
          <span className="text-[10px] text-red-400 ml-2">已 Miss {result.total_misses} 次</span>
        )}
      </div>
      <div className="px-3 py-2 space-y-2">
        <p className="text-xs text-zinc-400">{result.hint}</p>
        {result.web_results && result.web_results.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-zinc-500">联网搜索结果：</p>
            {result.web_results.map((item, i) => (
              <WebResultItem key={i} item={item} query={result.query || ""} />
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-600">未配置联网搜索，请在设置中填写 Web Search API Key</p>
        )}
      </div>
    </div>
  )
}

function ResearchResultCard({ researchResult }: { researchResult: ResearchResult }) {
  const [showSources, setShowSources] = useState(false)
  const [expandedSnippets, setExpandedSnippets] = useState<Set<number>>(new Set())

  const toggleSnippet = (i: number) => {
    setExpandedSnippets(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className="max-w-[85%] w-full rounded-xl bg-zinc-900 border border-zinc-800 border-l-2 border-l-purple-500 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-800">
        <FlaskConical size={13} className="text-purple-400" />
        <span className="text-xs font-medium text-purple-400">深度研究</span>
        <span className="text-[10px] text-zinc-500">
          {researchResult.searchResults.length} 搜索 · {researchResult.evaluatedCount} 筛选 · {researchResult.deepReadCount} 深读 · {(researchResult.durationMs / 1000).toFixed(1)}s
        </span>
      </div>
      {researchResult.summary ? (
        <div className="px-3 py-3">
          {researchResult.summaryFallback && (
            <div className="mb-2 px-2 py-1 rounded bg-amber-900/30 border border-amber-700/30 text-[10px] text-amber-400">
              LLM 总结失败，以下为深读内容摘要（仅供参考）
            </div>
          )}
          <div className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{researchResult.summary}</div>
          {researchResult.sources.length > 0 && (
            <div className="mt-3 pt-2 border-t border-zinc-800">
              <button
                onClick={() => setShowSources(!showSources)}
                className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
              >
                {showSources ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                参考来源 ({researchResult.sources.length})
              </button>
              {showSources && (
                <div className="mt-2 space-y-1">
                  {researchResult.sources.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-500">[{i + 1}]</span>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 truncate">
                        {s.title}
                      </a>
                      <ExternalLink size={8} className="text-zinc-600 shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-2 space-y-2">
          <p className="text-xs text-zinc-400">未配置 LLM 模型，仅返回搜索结果</p>
          {researchResult.searchResults.slice(0, 10).map((item, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-400 hover:text-blue-300 truncate block">
                {item.title}
              </a>
              <p className={`text-[10px] text-zinc-500 mt-0.5 ${expandedSnippets.has(i) ? "" : "line-clamp-2"}`}>{item.snippet}</p>
              {item.snippet && item.snippet.length > 80 && (
                <button onClick={() => toggleSnippet(i)} className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-500 hover:text-zinc-300">
                  {expandedSnippets.has(i) ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  {expandedSnippets.has(i) ? "收起" : "展开"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {researchResult.phaseLog.length > 0 && (
        <div className="px-3 py-1.5 border-t border-zinc-800">
          <p className="text-[9px] text-zinc-600">{researchResult.phaseLog.join(" → ")}</p>
        </div>
      )}
    </div>
  )
}

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

function AgentResearchCard({ result, progress, errorDetail }: {
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

function PipelineResultsCard({ searchResult, onIngest, onGenerateWorkKey }: {
  searchResult: PipelineSearchResponse
  onIngest: (query: string, title: string, content: string, url?: string) => void
  onGenerateWorkKey: (query: string, results: PipelineSearchResult[]) => void
}) {
  return (
    <div className="max-w-[85%] w-full rounded-xl bg-zinc-900 border border-zinc-800 border-l-2 border-l-blue-500 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-zinc-800">
        <Search size={13} className="text-blue-400" />
        <span className="text-xs font-medium text-blue-400">多源搜索</span>
        <span className="text-[10px] text-zinc-500">
          {searchResult.totalSources} 来源 · {searchResult.results.length} 结果 · {(searchResult.durationMs / 1000).toFixed(1)}s
        </span>
        <button
          onClick={() => onGenerateWorkKey(searchResult.query, searchResult.results)}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-violet-800/50 text-violet-300 hover:bg-violet-700/50 transition-colors ml-auto"
        >
          <Key size={10} />
          生成 Work Key
        </button>
      </div>
      <div className="px-3 py-2 space-y-2">
        {searchResult.results.map((item, i) => (
          <PipelineResultItem key={i} item={item} query={searchResult.query} onIngest={onIngest} />
        ))}
      </div>
    </div>
  )
}

function PipelineResultItem({ item, query, onIngest }: {
  item: PipelineSearchResult
  query: string
  onIngest: (query: string, title: string, content: string, url?: string) => void
}) {
  const [reading, setReading] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const [detailTitle, setDetailTitle] = useState<string>("")
  const [expanded, setExpanded] = useState(false)

  const handleDeepRead = async () => {
    if (reading) return
    setReading(true)
    try {
      const result = await askDeepRead(item.url)
      if (result.success && result.content) {
        setDetail(result.content)
        setDetailTitle(result.title)
      } else {
        setDetail("深度读取失败")
      }
    } catch {
      setDetail("深度读取失败")
    }
    setReading(false)
  }

  const sourceTypeColors: Record<string, string> = {
    official: "bg-emerald-900/50 text-emerald-400",
    documentation: "bg-blue-900/50 text-blue-400",
    repository: "bg-violet-900/50 text-violet-400",
    platform: "bg-amber-900/50 text-amber-400",
    blog: "bg-orange-900/50 text-orange-400",
    "llm-knowledge": "bg-purple-900/50 text-purple-400",
    unknown: "bg-zinc-800 text-zinc-400",
  }
  const sourceNames: Record<string, string> = {
    "web-search-prime": "智谱搜索",
    "xbrowser": "XBrowser",
    "llm-direct": "LLM",
    "plugin": "插件",
  }
  const badge = sourceTypeColors[item.sourceType] || sourceTypeColors.unknown
  const sourceName = sourceNames[item.source] || item.source

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="px-2.5 py-1.5">
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-400 hover:text-blue-300 truncate">
                  {item.title}
                </a>
              ) : (
                <span className="text-xs font-medium text-zinc-200 truncate">{item.title}</span>
              )}
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium ${badge}`}>
                {item.sourceType}
              </span>
            </div>
            <p className={`text-[10px] text-zinc-500 mt-0.5 ${expanded ? "" : "line-clamp-2"}`}>{item.snippet}</p>
            {item.snippet && item.snippet.length > 80 && (
              <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-500 hover:text-zinc-300">
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {expanded ? "收起" : "展开"}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[9px] text-zinc-600">{sourceName}</span>
          {item.qualityScore > 0 && (
            <>
              <div className="hidden sm:flex items-center gap-1 flex-1">
                <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-zinc-600 to-emerald-400"
                    style={{ width: `${item.qualityScore}%` }}
                  />
                </div>
                <span className="text-[9px] text-zinc-500">{item.qualityScore}</span>
              </div>
              <span className="sm:hidden text-[9px] text-zinc-500">{item.qualityScore}</span>
            </>
          )}
        </div>
      </div>
      {item.url && (
        <div className="px-2.5 py-1.5 border-t border-zinc-800 flex items-center gap-2">
          <button
            onClick={handleDeepRead}
            disabled={reading}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {reading ? <Loader2 size={10} className="animate-spin" /> : <BookOpen size={10} />}
            {reading ? "读取中..." : "深度读取"}
          </button>
        </div>
      )}
      {detail && (
        <div className="px-2.5 py-2 border-t border-zinc-800">
          <div className="text-[10px] text-zinc-400 whitespace-pre-wrap max-h-40 overflow-y-auto">{detail.slice(0, 5000)}</div>
          {detail !== "深度读取失败" && (
            <button
              onClick={() => onIngest(query, detailTitle || item.title, detail, item.url)}
              className="flex items-center gap-1 px-2 py-1 mt-2 rounded text-[10px] font-medium bg-teal-700 text-white hover:bg-teal-600 transition-colors"
            >
              <Save size={10} />
              存入知识库
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function WebResultItem({ item, query }: { item: WebSearchItem; query: string }) {
  const [reading, setReading] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const [showIngest, setShowIngest] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const handleRead = async () => {
    if (reading) return
    setReading(true)
    try {
      const result = await webRead(item.link)
      if (result.success && result.content) {
        setDetail(result.content)
        setShowIngest(true)
      } else {
        setDetail("抓取失败")
      }
    } catch {
      setDetail("抓取失败")
    }
    setReading(false)
  }

  const handleSave = () => {
    if (detail && item.title) {
      useAskStore.getState().ingest(item.link, item.title, detail, ["reference", "web-ingested"])
      setShowIngest(false)
      setDetail(null)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
      <div className="px-2.5 py-1.5">
        <div className="flex items-start gap-1.5">
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-blue-400 hover:text-blue-300 truncate flex-1"
          >
            {item.title}
          </a>
          <ExternalLink size={10} className="text-zinc-600 shrink-0 mt-0.5" />
        </div>
        <p className={`text-[10px] text-zinc-500 mt-0.5 ${expanded ? "" : "line-clamp-2"}`}>{item.content}</p>
        {item.content && item.content.length > 80 && (
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-500 hover:text-zinc-300">
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {expanded ? "收起" : "展开"}
          </button>
        )}
      </div>
      <div className="px-2.5 py-1.5 border-t border-zinc-800 flex items-center gap-2">
        <button
          onClick={handleRead}
          disabled={reading}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {reading ? <Loader2 size={10} className="animate-spin" /> : <Globe size={10} />}
          {reading ? "抓取中..." : "读取详情"}
        </button>
      </div>
      {detail && (
        <div className="px-2.5 py-2 border-t border-zinc-800">
          <div className="text-[10px] text-zinc-400 whitespace-pre-wrap max-h-40 overflow-y-auto">{detail.slice(0, 3000)}</div>
          {showIngest && (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-2 py-1 mt-2 rounded text-[10px] font-medium bg-teal-700 text-white hover:bg-teal-600 transition-colors"
            >
              <Save size={10} />
              存入知识库
            </button>
          )}
        </div>
      )}
    </div>
  )
}
