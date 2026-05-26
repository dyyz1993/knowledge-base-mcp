import { useState, useEffect, useRef } from "react"
import { Search, X, FileText, Loader2 } from "lucide-react"
import { useDocStore } from "../stores/docs"
import TagBadge from "./TagBadge"
import { useTheme } from "../theme"

export default function SearchPalette({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (id: string) => void }) {
  const [q, setQ] = useState("")
  const { searchResults, search, searching } = useDocStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const { theme } = useTheme()
  const isDark = theme === "dark"

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
      <div className={`fixed inset-0 ${isDark ? "bg-black/60" : "bg-black/40"}`} />
      <div className={`relative w-full max-w-xl border rounded-xl shadow-2xl overflow-hidden ${isDark ? "bg-zinc-900 border-zinc-700" : "bg-white border-gray-300"}`} onClick={e => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") onClose() }}>
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          <Search size={18} className={`${isDark ? "text-zinc-500" : "text-gray-400"} shrink-0`} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search documents..."
            aria-label="搜索文档"
            className={`flex-1 bg-transparent outline-none ${isDark ? "text-zinc-100 placeholder:text-zinc-600" : "text-gray-900 placeholder:text-gray-400"}`}
            autoFocus
          />
          {searching && <Loader2 size={14} className={`animate-spin ${isDark ? "text-zinc-500" : "text-gray-400"}`} />}
          <button onClick={onClose} className={`p-1 rounded ${isDark ? "hover:bg-zinc-700" : "hover:bg-gray-100"}`} aria-label="Close search">
            <X size={16} className={isDark ? "text-zinc-500" : "text-gray-400"} />
          </button>
        </div>
        {q && (
          <div className="max-h-80 overflow-y-auto">
            {searching ? (
              <div className={`flex items-center justify-center gap-2 py-6 text-xs ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
                <Loader2 size={14} className="animate-spin" />
                <span>Searching...</span>
              </div>
            ) : searchResults.length === 0 ? (
              <div className={`px-4 py-6 text-center ${isDark ? "text-zinc-600" : "text-gray-400"}`}>No results found. Try different keywords?</div>
            ) : (
              <>
                <div className={`text-xs px-3 py-1 ${isDark ? "text-zinc-500" : "text-gray-500"}`}>{searchResults.length} result{searchResults.length !== 1 ? "s" : ""} found</div>
                {searchResults.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => { onSelect(doc.id); onClose() }}
                    aria-label={`选择文档 ${doc.title}`}
                    className={`w-full text-left px-4 py-3 flex items-start gap-3 border-b ${isDark ? "hover:bg-zinc-800 border-zinc-800/50" : "hover:bg-gray-50 border-gray-100"}`}
                  >
                    <FileText size={16} className={`${isDark ? "text-zinc-600" : "text-gray-400"} mt-0.5 shrink-0`} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-sm truncate ${isDark ? "text-zinc-200" : "text-gray-800"}`}>{doc.title}</div>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {doc.tags.slice(0, 3).map(t => <TagBadge key={t} tag={t} />)}
                      </div>
                    </div>
                    <span className={`text-xs mt-1 ${isDark ? "text-zinc-600" : "text-gray-400"}`}>{doc.score?.toFixed(1) ?? '-'}pt</span>
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
