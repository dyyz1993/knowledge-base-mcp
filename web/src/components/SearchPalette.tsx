import { useState, useEffect, useRef } from "react"
import { Search, X, FileText } from "lucide-react"
import { useDocStore } from "../stores/docs"
import type { DocMeta } from "../services/api"
import TagBadge from "./TagBadge"

export default function SearchPalette({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (id: string) => void }) {
  const [q, setQ] = useState("")
  const { searchResults, search } = useDocStore()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQ("")
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    if (q) search(q)
  }, [q])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/60" />
      <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Search size={18} className="text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search documents..."
            className="flex-1 bg-transparent text-zinc-100 outline-none placeholder:text-zinc-600"
            autoFocus
          />
          <button onClick={onClose} className="p-1 rounded hover:bg-zinc-700">
            <X size={16} className="text-zinc-500" />
          </button>
        </div>
        {q && (
          <div className="max-h-80 overflow-y-auto">
            {searchResults.length === 0 ? (
              <div className="px-4 py-6 text-center text-zinc-600">No results</div>
            ) : (
              searchResults.map((doc: DocMeta & { score: number }) => (
                <button
                  key={doc.id}
                  onClick={() => { onSelect(doc.id); onClose() }}
                  className="w-full text-left px-4 py-3 hover:bg-zinc-800 flex items-start gap-3 border-b border-zinc-800/50"
                >
                  <FileText size={16} className="text-zinc-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-200 truncate">{doc.title}</div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {doc.tags.slice(0, 3).map(t => <TagBadge key={t} tag={t} />)}
                    </div>
                  </div>
                  <span className="text-xs text-zinc-600 mt-1">{doc.score}pt</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
