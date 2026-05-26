import { useState } from "react"
import { AlertTriangle, Database, Globe, ChevronDown, ChevronUp } from "lucide-react"
import { useAskStore } from "../../stores/ask"
import { AgentResearchCard } from "./AgentResearchCard"
import { ResearchResultCard } from "./ResearchResultCard"
import { PipelineResultsCard } from "./PipelineResultsCard"
import { WebResultItem } from "./WebResultItem"
import type { AskResult, PipelineSearchResponse, ResearchResult, AgentResearchResult, AgentResearchProgress } from "../../services/api"
import { useTheme } from "../../theme"

interface ResultCardProps {
  msg: {
    id: string
    content: string
    result?: AskResult
    searchResult?: PipelineSearchResponse
    researchResult?: ResearchResult
    agentResearchResult?: AgentResearchResult
    agentResearchProgress?: AgentResearchProgress[]
    errorDetail?: string
  }
  expanded: boolean
  onToggle: () => void
}

export function ResultCard({ msg, expanded, onToggle }: ResultCardProps) {
  const [showError, setShowError] = useState(false)
  const result = msg.result
  const { theme } = useTheme()
  const isDark = theme === "dark"

  if (msg.errorDetail && !result && !msg.searchResult && !msg.researchResult && !msg.agentResearchResult) {
    return (
      <div className={`max-w-[95%] md:max-w-[85%] rounded-xl border border-l-2 border-l-red-500 overflow-hidden ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-gray-200"}`} role="alert">
        <div className="px-3 py-2 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span className={`text-sm ${isDark ? "text-red-300" : "text-red-600"}`}>{msg.content}</span>
        </div>
        <div className="px-3 pb-2">
          <button onClick={() => setShowError(!showError)} aria-expanded={showError} className={`flex items-center gap-1 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
            {showError ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            查看详情
          </button>
          {showError && (
            <div className={`mt-1 p-2 rounded text-[10px] whitespace-pre-wrap break-all ${isDark ? "bg-zinc-950 text-zinc-400" : "bg-gray-100 text-gray-600"}`}>{msg.errorDetail}</div>
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
    return <div className={`max-w-[95%] md:max-w-[85%] px-3 py-2 rounded-xl border text-sm ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-gray-200 text-gray-800"}`}>{msg.content}</div>
  }

  if (result.from_kb) {
    return (
      <div className={`max-w-[95%] md:max-w-[85%] w-full rounded-xl border border-l-2 border-l-emerald-500 overflow-hidden ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-gray-200"}`}>
        <div className={`px-3 py-2 flex items-center gap-2 border-b ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          <Database size={13} className="text-emerald-400" />
          <span className="text-xs font-medium text-emerald-400">知识库命中</span>
          {result.score != null && <span className={`text-[10px] ml-auto ${isDark ? "text-zinc-500" : "text-gray-500"}`}>相似度: {result.score}</span>}
        </div>
        <div className="px-3 py-2">
          <p className={`text-sm font-medium ${isDark ? "text-zinc-200" : "text-gray-800"}`}>{result.title}</p>
          {result.content && (
            <div className="mt-2">
              <div
                className={`text-xs whitespace-pre-wrap ${isDark ? "text-zinc-400" : "text-gray-600"} ${!expanded ? "line-clamp-4" : ""}`}
              >
                {result.content}
              </div>
              {result.content.length > 200 && (
                <button onClick={onToggle} aria-expanded={expanded} className={`flex items-center gap-1 mt-1 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
                  {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  {expanded ? "收起" : "展开"}
                </button>
              )}
            </div>
          )}
        </div>
        {result.degraded && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 bg-amber-400/10 border-t border-amber-400/20">
            <AlertTriangle size={12} />
            <span>搜索结果可能不完整 — 部分搜索服务暂时不可用</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`max-w-[95%] md:max-w-[85%] w-full rounded-xl border border-l-2 border-l-amber-500 overflow-hidden ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-gray-200"}`}>
      <div className={`px-3 py-2 flex items-center gap-2 border-b ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <Globe size={13} className="text-amber-400" />
        <span className="text-xs font-medium text-amber-400">未命中知识库</span>
        {result.recurring && (
          <span className="text-[10px] text-red-400 ml-2">已 Miss {result.total_misses} 次</span>
        )}
      </div>
      <div className="px-3 py-2 space-y-2">
        <p className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-600"}`}>{result.hint}</p>
        {result.web_results && result.web_results.length > 0 ? (
          <div className="space-y-1.5">
            <p className={`text-[11px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>联网搜索结果：</p>
            {result.web_results.map((item, i) => (
              <WebResultItem key={i} item={item} query={result.query || ""} />
            ))}
          </div>
        ) : (
          <p className={`text-[11px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>未配置联网搜索，请在设置中填写 Web Search API Key</p>
        )}
      </div>
      {result.degraded && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-amber-400 bg-amber-400/10 border-t border-amber-400/20">
          <AlertTriangle size={12} />
          <span>搜索结果可能不完整 — 部分搜索服务暂时不可用</span>
        </div>
      )}
    </div>
  )
}
