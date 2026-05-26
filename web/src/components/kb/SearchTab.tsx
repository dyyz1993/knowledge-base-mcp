import { useState, useCallback } from "react"
import { Search, FileText, Tag, Plus, ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { Empty, Spin } from "antd"
import { readDoc } from "../../services/api"
import { MarkdownRenderer } from "../MarkdownRenderer"
import { useTheme } from "../../theme"

interface KBDocResult {
  id: string
  title: string
  tags?: string[]
  keywords?: string[]
  intent?: string
  score?: number
  snippet?: string
}

export function SearchTab({
  kbQuery,
  kbResults,
  kbSearching,
  setKBQuery,
  onSearch,
  onKey,
  onWriteOpen,
}: {
  kbQuery: string
  kbResults: KBDocResult[]
  kbSearching: boolean
  setKBQuery: (q: string) => void
  onSearch: () => void
  onKey: (e: React.KeyboardEvent) => void
  onWriteOpen: () => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<string>("")
  const [expandedLoading, setExpandedLoading] = useState(false)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const toggleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setExpandedContent("")
      return
    }
    setExpandedId(id)
    setExpandedLoading(true)
    try {
      const doc = await readDoc(id)
      setExpandedContent(doc ? doc.content : "Failed to load")
    } catch {
      setExpandedContent("Failed to load document")
    }
    setExpandedLoading(false)
  }, [expandedId])

  return (
    <>
      <div className={`p-2 border-b space-y-2 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <div className="flex items-center gap-1.5">
          <div className={`flex-1 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${isDark ? "border-zinc-700 bg-zinc-900" : "border-gray-300 bg-white"}`}>
            <Search size={13} className={isDark ? "text-zinc-500 shrink-0" : "text-gray-400 shrink-0"} />
            <input
              value={kbQuery}
              onChange={(e) => setKBQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search knowledge base..."
              aria-label="搜索知识库"
              className={`flex-1 bg-transparent text-xs outline-none ${isDark ? "text-zinc-200 placeholder-zinc-600" : "text-gray-800 placeholder-gray-400"}`}
            />
          </div>
          <button
            onClick={onSearch}
            disabled={kbSearching}
            aria-label="搜索"
            className={`shrink-0 rounded-lg px-2 py-1.5 text-xs transition-colors disabled:opacity-50 ${isDark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {kbSearching ? <Spin size="small" /> : "Go"}
          </button>
        </div>
        <button
          onClick={onWriteOpen}
          aria-label="写入知识库"
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 py-1.5 text-xs transition-colors ${isDark ? "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500" : "border-gray-300 text-gray-500 hover:text-gray-700 hover:border-gray-400"}`}
        >
          <Plus size={12} />
          <span>Write to KB</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {kbSearching && (
          <div className={`flex items-center justify-center gap-2 py-6 text-xs ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
            <Loader2 size={14} className="animate-spin" />
            <span>Searching...</span>
          </div>
        )}
        {!kbSearching && kbResults.map((doc) => (
          <div key={doc.id}>
            <div
              onClick={() => toggleExpand(doc.id)}
              role="button"
              tabIndex={0}
              aria-expanded={expandedId === doc.id}
              aria-label={`展开 ${doc.title}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleExpand(doc.id) } }}
              className={`rounded-lg border p-2.5 transition-colors cursor-pointer ${isDark ? "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900" : "border-gray-200 bg-white hover:bg-gray-50"} ${
                expandedId === doc.id ? "border-blue-500/30" : ""
              }`}
            >
              <div className="flex items-start gap-2">
                <FileText size={13} className={isDark ? "text-zinc-500 shrink-0 mt-0.5" : "text-gray-400 shrink-0 mt-0.5"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-medium truncate ${isDark ? "text-zinc-200" : "text-gray-800"}`}>{doc.title}</span>
                    {expandedId === doc.id ? <ChevronDown size={12} className={isDark ? "text-zinc-500 shrink-0" : "text-gray-400 shrink-0"} /> : <ChevronRight size={12} className={isDark ? "text-zinc-500 shrink-0" : "text-gray-400 shrink-0"} />}
                  </div>
                  {doc.intent && (
                    <p className={`text-[10px] mt-0.5 line-clamp-1 ${isDark ? "text-zinc-500" : "text-gray-500"}`}>{doc.intent}</p>
                  )}
                  {doc.snippet && !doc.intent && (
                    <p className={`text-[10px] mt-0.5 line-clamp-2 ${isDark ? "text-zinc-500" : "text-gray-500"}`}>{doc.snippet}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-mono ${isDark ? "text-zinc-600" : "text-gray-400"}`}>#{doc.id.slice(0, 8)}</span>
                    {doc.score != null && (
                      <span className={`text-[10px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>{(doc.score * 100).toFixed(0)}%</span>
                    )}
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.slice(0, 3).map((t) => (
                          <span key={t} className={`inline-flex items-center gap-0.5 text-[10px] ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
                            <Tag size={8} />{t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {expandedId === doc.id && (
              <div className={`mt-1 rounded-b-lg border border-t-0 p-3 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-gray-50"}`}>
                {expandedLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Spin size="small" />
                    <span className={`ml-2 text-xs ${isDark ? "text-zinc-500" : "text-gray-500"}`}>Loading content...</span>
                  </div>
                ) : (
                  <div className={`markdown-body text-xs ${isDark ? "text-zinc-300" : "text-gray-700"}`}>
                    <MarkdownRenderer content={expandedContent} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!kbSearching && kbQuery && kbResults.length === 0 && (
          <div className="py-8">
            <Empty description={<span className={`text-xs ${isDark ? "text-zinc-500" : "text-gray-500"}`}>No matching documents found. Try different keywords?</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
        {!kbSearching && !kbQuery && (
          <div className="py-8">
            <Empty description={<span className={`text-xs ${isDark ? "text-zinc-500" : "text-gray-500"}`}>Enter keywords to search the knowledge base</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
        {!kbSearching && kbResults.length > 0 && kbQuery && (
          <div className={`text-center text-[10px] pb-2 ${isDark ? "text-zinc-600" : "text-gray-400"}`}>
            {kbResults.length} result{kbResults.length !== 1 ? "s" : ""} found
          </div>
        )}
      </div>
    </>
  )
}

export type { KBDocResult }
