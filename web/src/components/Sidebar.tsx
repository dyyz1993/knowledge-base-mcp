import { useMemo } from "react"
import { FolderOpen, FileText, ChevronRight, ChevronDown } from "lucide-react"
import { useState } from "react"
import type { DocMeta } from "../services/api"
import TagBadge from "./TagBadge"
import { ListSkeleton } from "./Skeleton"
import { useTheme } from "../theme"

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
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const toggle = (name: string) => setCollapsed(p => ({ ...p, [name]: !p[name] }))

  return (
    <aside className={`w-72 shrink-0 border-r flex flex-col h-full overflow-hidden ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-white"}`} role="navigation" aria-label="文档导航">
      <div className={`px-4 py-3 border-b flex items-center gap-2 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <FolderOpen size={16} className="text-blue-400" />
        <span className={`text-sm font-medium ${isDark ? "text-zinc-300" : "text-gray-700"}`}>Knowledge Base</span>
        <span className={`ml-auto text-xs ${isDark ? "text-zinc-600" : "text-gray-400"}`}>{docs.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {docs.length === 0 ? (
          <ListSkeleton count={8} />
        ) : (
          Object.entries(groups).map(([name, items]) => (
          <div key={name}>
            <button
              onClick={() => toggle(name)}
              aria-expanded={!collapsed[name]}
              className={`w-full text-left px-4 py-1.5 flex items-center gap-1.5 text-xs transition-colors ${isDark ? "hover:bg-zinc-900 text-zinc-400" : "hover:bg-gray-100 text-gray-500"}`}
            >
              {collapsed[name] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="font-medium">{name}</span>
              <span className={`ml-auto ${isDark ? "text-zinc-600" : "text-gray-400"}`}>{items.length}</span>
            </button>
            {!collapsed[name] && items.map(doc => (
              <button
                key={doc.id}
                onClick={() => onSelect(doc.id)}
                aria-current={selectedId === doc.id ? "page" : undefined}
                className={`w-full text-left pl-8 pr-3 py-1.5 flex items-start gap-2 text-xs transition-colors ${isDark ? "hover:bg-zinc-900" : "hover:bg-gray-100"} ${selectedId === doc.id ? (isDark ? "bg-zinc-900 text-zinc-100" : "bg-gray-100 text-gray-900") : (isDark ? "text-zinc-400" : "text-gray-600")}`}
              >
                <FileText size={13} className={`mt-0.5 shrink-0 ${isDark ? "text-zinc-600" : "text-gray-400"}`} />
                <span className="truncate leading-tight">{doc.title}</span>
              </button>
            ))}
          </div>
        ))
        )}
      </div>
    </aside>
  )
}
