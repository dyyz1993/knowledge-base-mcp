import { useMemo } from "react"
import { FolderOpen, FileText, ChevronRight, ChevronDown } from "lucide-react"
import { useState } from "react"
import type { DocMeta } from "../services/api"
import TagBadge from "./TagBadge"

function groupByProject(docs: DocMeta[]): Record<string, DocMeta[]> {
  const groups: Record<string, DocMeta[]> = {}
  for (const d of docs) {
    const key = d.source_project || "Uncategorized"
    const name = key.split("/").pop() || key
    ;(groups[name] ||= []).push(d)
  }
  return groups
}

export default function Sidebar({ docs, selectedId, onSelect }: { docs: DocMeta[]; selectedId?: string; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const groups = useMemo(() => groupByProject(docs), [docs])

  const toggle = (name: string) => setCollapsed(p => ({ ...p, [name]: !p[name] }))

  return (
    <aside className="w-72 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <FolderOpen size={16} className="text-blue-400" />
        <span className="text-sm font-medium text-zinc-300">Knowledge Base</span>
        <span className="ml-auto text-xs text-zinc-600">{docs.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {Object.entries(groups).map(([name, items]) => (
          <div key={name}>
            <button
              onClick={() => toggle(name)}
              className="w-full text-left px-4 py-1.5 flex items-center gap-1.5 hover:bg-zinc-900 text-zinc-400 text-xs"
            >
              {collapsed[name] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="font-medium">{name}</span>
              <span className="ml-auto text-zinc-600">{items.length}</span>
            </button>
            {!collapsed[name] && items.map(doc => (
              <button
                key={doc.id}
                onClick={() => onSelect(doc.id)}
                className={`w-full text-left pl-8 pr-3 py-1.5 flex items-start gap-2 text-xs hover:bg-zinc-900 transition-colors ${selectedId === doc.id ? "bg-zinc-900 text-zinc-100" : "text-zinc-400"}`}
              >
                <FileText size={13} className="mt-0.5 shrink-0 text-zinc-600" />
                <span className="truncate leading-tight">{doc.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
