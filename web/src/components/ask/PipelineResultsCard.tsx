import { useState } from "react"
import { ChevronDown, ChevronUp, Search, Key, BookOpen, Save, Loader2 } from "lucide-react"
import { askDeepRead } from "../../services/api"
import type { PipelineSearchResponse, PipelineSearchResult } from "../../services/api"
import { useTheme } from "../../theme"

export function PipelineResultsCard({ searchResult, onIngest, onGenerateWorkKey }: {
  searchResult: PipelineSearchResponse
  onIngest: (query: string, title: string, content: string, url?: string) => void
  onGenerateWorkKey: (query: string, results: PipelineSearchResult[]) => void
}) {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  return (
    <div className={`max-w-[85%] w-full rounded-xl border border-l-2 border-l-blue-500 overflow-hidden ${isDark ? "bg-zinc-900 border-zinc-800" : "bg-white border-gray-200"}`}>
      <div className={`px-3 py-2 flex items-center gap-2 border-b ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <Search size={13} className="text-blue-400" />
        <span className="text-xs font-medium text-blue-400">多源搜索</span>
        <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
          {searchResult.totalSources} 来源 · {searchResult.results.length} 结果 · {(searchResult.durationMs / 1000).toFixed(1)}s
        </span>
        <button
          onClick={() => onGenerateWorkKey(searchResult.query, searchResult.results)}
          aria-label="生成 Work Key"
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
  const { theme } = useTheme()
  const isDark = theme === "dark"

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
    unknown: isDark ? "bg-zinc-800 text-zinc-400" : "bg-gray-100 text-gray-600",
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
    <div className={`rounded-lg border overflow-hidden ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-gray-50"}`}>
      <div className="px-2.5 py-1.5">
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              {item.url ? (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-blue-400 hover:text-blue-300 truncate">
                  {item.title}
                </a>
              ) : (
                <span className={`text-xs font-medium truncate ${isDark ? "text-zinc-200" : "text-gray-800"}`}>{item.title}</span>
              )}
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium ${badge}`}>
                {item.sourceType}
              </span>
            </div>
            <p className={`text-[10px] mt-0.5 ${isDark ? "text-zinc-500" : "text-gray-500"} ${expanded ? "" : "line-clamp-2"}`}>{item.snippet}</p>
            {item.snippet && item.snippet.length > 80 && (
              <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className={`flex items-center gap-1 mt-0.5 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {expanded ? "收起" : "展开"}
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`text-[9px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>{sourceName}</span>
          {item.qualityScore > 0 && (
            <>
              <div className="hidden sm:flex items-center gap-1 flex-1">
                <div className={`flex-1 h-1 rounded-full overflow-hidden ${isDark ? "bg-zinc-800" : "bg-gray-200"}`}>
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-zinc-600 to-emerald-400"
                    style={{ width: `${item.qualityScore}%` }}
                  />
                </div>
                <span className={`text-[9px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>{item.qualityScore}</span>
              </div>
              <span className={`sm:hidden text-[9px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>{item.qualityScore}</span>
            </>
          )}
        </div>
      </div>
      {item.url && (
        <div className={`px-2.5 py-1.5 border-t flex items-center gap-2 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          <button
            onClick={handleDeepRead}
            disabled={reading}
            aria-label={reading ? "正在读取" : "深度读取"}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-50 transition-colors ${isDark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {reading ? <Loader2 size={10} className="animate-spin" /> : <BookOpen size={10} />}
            {reading ? "读取中..." : "深度读取"}
          </button>
        </div>
      )}
      {detail && (
        <div className={`px-2.5 py-2 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          <div className={`text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto ${isDark ? "text-zinc-400" : "text-gray-600"}`}>{detail.slice(0, 5000)}</div>
          {detail !== "深度读取失败" && (
            <button
              onClick={() => onIngest(query, detailTitle || item.title, detail, item.url)}
              aria-label="存入知识库"
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
