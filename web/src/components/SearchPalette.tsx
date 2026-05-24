import { useState, useEffect, useRef } from "react"
import { Search, X, FileText, Loader2 } from "lucide-react"
import { useDocStore } from "../stores/docs"
import TagBadge from "./TagBadge"

export default function SearchPalette({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (id: string) => void }) {
  const [q, setQ] = useState("")
  const { searchResults, search, searching } = useDocStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (open) {
      setQ("")
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (q) {
      timerRef.current = setTimeout(() => search(q), 300)
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [q])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose} role="dialog" aria-modal="true" aria-label="搜索文档">
      <div className="fixed inset-0 bg-black/60" />
      <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Search size={18} className="text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search documents..."
            aria-label="搜索文档"
            className="flex-1 bg-transparent text-zinc-100 outline-none placeholder:text-zinc-600"
            autoFocus
          />
          {searching && <Loader2 size={14} className="animate-spin text-zinc-500" />}
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700" aria-label="Close search">
            <X size={16} className="text-zinc-500" />
          </button>
        </div>
        {q && (
          <div className="max-h-80 overflow-y-auto">
            {searching ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-zinc-500">
                <Loader2 size={14} className="animate-spin" />
                <span>Searching...</span>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="px-4 py-6 text-center text-zinc-600">No results found. Try different keywords?</div>
            ) : (
              <>
                <div className="text-xs text-zinc-500 px-3 py-1">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found</div>
                {searchResults.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => { onSelect(doc.id); onClose() }}
                    aria-label={`选择文档 ${doc.title}`}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-800 flex items-start gap-3 border-b border-zinc-800/50"
                  >
                    <FileText size={16} className="text-zinc-600 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-zinc-200 truncate">{doc.title}</div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {doc.tags.slice(0, 3).map(t => <TagBadge key={t} tag={t} />)}
                      </div>
                    </div>
                    <span className="text-xs text-zinc-600 mt-1">{doc.score?.toFixed(1) ?? '-'}pt</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
