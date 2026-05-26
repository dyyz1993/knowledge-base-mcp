import { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink, FlaskConical } from "lucide-react"
import type { ResearchResult } from "../../services/api"
import { useTheme } from "../../theme"

export function ResearchResultCard({ researchResult }: { researchResult: ResearchResult }) {
  const [showSources, setShowSources] = useState(false)
  const [expandedSnippets, setExpandedSnippets] = useState<Set<number>>(new Set())
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const toggleSnippet = (i: number) => {
    setExpandedSnippets(prev => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div className={`max-w-[85%] w-full rounded-xl border border-l-2 border-l-purple-500 overflow-hidden ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-gray-200"}`}>
      <div className={`px-3 py-2 flex items-center gap-2 border-b ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <FlaskConical size={13} className="text-purple-400" />
        <span className="text-xs font-medium text-purple-400">深度研究</span>
        <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
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
          <div className={`text-sm whitespace-pre-wrap leading-relaxed ${isDark ? "text-zinc-200" : "text-gray-800"}`}>{researchResult.summary}</div>
          {researchResult.sources.length > 0 && (
            <div className={`mt-3 pt-2 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
              <button
                onClick={() => setShowSources(!showSources)}
                aria-expanded={showSources}
                className={`flex items-center gap-1 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}
              >
                {showSources ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                参考来源 ({researchResult.sources.length})
              </button>
              {showSources && (
                <div className="mt-2 space-y-1">
                  {researchResult.sources.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>[{i + 1}]</span>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-400 hover:text-blue-300 truncate">
                        {s.title}
                      </a>
                      <ExternalLink size={8} className={`${isDark ? "text-zinc-600" : "text-gray-400"} shrink-0`} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-2 space-y-2">
          <p className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-600"}`}>未配置 LLM 模型，仅返回搜索结果</p>
          {researchResult.searchResults.slice(0, 10).map((item, i) => (
            <div key={i} className={`rounded-lg border px-2.5 py-1.5 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-gray-50"}`}>
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-400 hover:text-blue-300 truncate block">
                {item.title}
              </a>
              <p className={`text-[10px] mt-0.5 ${isDark ? "text-zinc-500" : "text-gray-500"} ${expandedSnippets.has(i) ? "" : "line-clamp-2"}`}>{item.snippet}</p>
              {item.snippet && item.snippet.length > 80 && (
                <button onClick={() => toggleSnippet(i)} aria-expanded={expandedSnippets.has(i)} className={`flex items-center gap-1 mt-0.5 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
                  {expandedSnippets.has(i) ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                  {expandedSnippets.has(i) ? "收起" : "展开"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {researchResult.phaseLog.length > 0 && (
        <div className={`px-3 py-1.5 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          <p className={`text-[9px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>{researchResult.phaseLog.join(" → ")}</p>
        </div>
      )}
    </div>
  )
}
