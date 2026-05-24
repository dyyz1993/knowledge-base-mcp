import { useState, useCallback } from "react"
import { Search, FileText, Tag, Plus, ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { Empty, Spin } from "antd"
import { readDoc } from "../../services/api"
import { MarkdownRenderer } from "../MarkdownRenderer"

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
      <div className="p-2 border-b border-zinc-800 space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5">
            <Search size={13} className="text-zinc-500 shrink-0" />
            <input
              value={kbQuery}
              onChange={(e) => setKBQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder="Search knowledge base..."
              aria-label="搜索知识库"
              className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
            />
          </div>
          <button
            onClick={onSearch}
            disabled={kbSearching}
            aria-label="搜索"
            className="shrink-0 rounded-lg bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            {kbSearching ? <Spin size="small" /> : "Go"}
          </button>
        </div>
        <button
          onClick={onWriteOpen}
          aria-label="写入知识库"
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors"
        >
          <Plus size={12} />
          <span>Write to KB</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {kbSearching && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
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
              className={`rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 hover:bg-zinc-900 transition-colors cursor-pointer ${
                expandedId === doc.id ? "border-blue-500/30" : ""
              }`}
            >
              <div className="flex items-start gap-2">
                <FileText size={13} className="text-zinc-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium text-zinc-200 truncate">{doc.title}</span>
                    {expandedId === doc.id ? <ChevronDown size={12} className="text-zinc-500 shrink-0" /> : <ChevronRight size={12} className="text-zinc-500 shrink-0" />}
                  </div>
                  {doc.intent && (
                    <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">{doc.intent}</p>
                  )}
                  {doc.snippet && !doc.intent && (
                    <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{doc.snippet}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-zinc-600 font-mono">#{doc.id.slice(0, 8)}</span>
                    {doc.score != null && (
                      <span className="text-[10px] text-zinc-600">{(doc.score * 100).toFixed(0)}%</span>
                    )}
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.slice(0, 3).map((t) => (
                          <span key={t} className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500">
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
              <div className="mt-1 rounded-b-lg border border-t-0 border-zinc-800 bg-zinc-950 p-3">
                {expandedLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Spin size="small" />
                    <span className="ml-2 text-xs text-zinc-500">Loading content...</span>
                  </div>
                ) : (
                  <div className="markdown-body text-xs text-zinc-300">
                    <MarkdownRenderer content={expandedContent} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!kbSearching && kbQuery && kbResults.length === 0 && (
          <div className="py-8">
            <Empty description={<span className="text-xs text-zinc-500">No matching documents found. Try different keywords?</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
        {!kbSearching && !kbQuery && (
          <div className="py-8">
            <Empty description={<span className="text-xs text-zinc-500">Enter keywords to search the knowledge base</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
        {!kbSearching && kbResults.length > 0 && kbQuery && (
          <div className="text-center text-[10px] text-zinc-600 pb-2">
            {kbResults.length} result{kbResults.length !== 1 ? "s" : ""} found
          </div>
        )}
      </div>
    </>
  )
}

export type { KBDocResult }
