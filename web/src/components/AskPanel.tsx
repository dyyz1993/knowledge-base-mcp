import { useState, useRef, useEffect } from "react"
import { Send, Sparkles, Database, Globe, Save, ChevronDown, ChevronUp, Trash2, ExternalLink, Loader2, Search, BookOpen, Key } from "lucide-react"
import { useAskStore } from "../stores/ask"
import { useChatStore } from "../stores/chat"
import { webRead, askDeepRead } from "../services/api"
import type { AskResult, WebSearchItem, PipelineSearchResponse, PipelineSearchResult } from "../services/api"

export default function AskPanel() {
  const { messages, loading, ask, clear } = useAskStore()
  const { models, currentModel, setModel: setChatModel } = useChatStore()
  const [input, setInput] = useState("")
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSubmit = () => {
    const q = input.trim()
    if (!q || loading) return
    setInput("")
    ask(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
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
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3">
            <Sparkles size={40} className="text-zinc-700" />
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-400">智能问答 — 你的知识助手</p>
              <p className="text-xs mt-1">描述你想了解的问题或需求，先搜知识库</p>
              <p className="text-xs text-zinc-600 mt-2">未命中时会引导你联网搜索并存储为新知识</p>
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
            <div className="px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-zinc-400 flex items-center gap-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              搜索中...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 p-3 shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="你想了解什么？描述一下你的问题..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 max-h-24"
          />
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
  msg: { id: string; content: string; result?: AskResult; searchResult?: PipelineSearchResponse }
  expanded: boolean
  onToggle: () => void
}) {
  const result = msg.result

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
            <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{item.snippet}</p>
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
        <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{item.content}</p>
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
