import { useState, useEffect, useCallback } from "react"
import { FileText, FolderOpen } from "lucide-react"
import { fetchOutlines, fetchOutline, readDoc } from "../../services/api"
import type { OutlineProject, OutlineDoc, Outline } from "../../services/api"
import { MarkdownRenderer } from "../MarkdownRenderer"

export function OutlineTab() {
  const [projects, setProjects] = useState<OutlineProject[]>([])
  const [selectedProject, setSelectedProject] = useState<string>("")
  const [outline, setOutline] = useState<Outline | null>(null)
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<string>("")
  const [expandedLoading, setExpandedLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      try { const data = await fetchOutlines(); setProjects(data) } catch (e) { if (import.meta.env.DEV) console.warn('[KBPanel] fetchOutlines failed:', e) }
    })()
  }, [])

  useEffect(() => {
    if (!selectedProject) {
      if (projects.length > 0) {
        setSelectedProject(projects[0].project)
      }
      return
    }
    ;(async () => { try { const data = await fetchOutline(selectedProject); setOutline(data) } catch { setOutline(null) } })()
  }, [selectedProject, projects])

  const toggleDoc = useCallback(async (doc: OutlineDoc) => {
    if (expandedDocId === doc.id) {
      setExpandedDocId(null)
      setExpandedContent("")
      return
    }
    setExpandedDocId(doc.id)
    setExpandedLoading(true)
    try {
      const result = await readDoc(doc.id)
      setExpandedContent(result ? result.content : "Failed to load")
    } catch {
      setExpandedContent("Failed to load document")
    }
    setExpandedLoading(false)
  }, [expandedDocId])

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-zinc-800">
        <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5">
          <FolderOpen size={13} className="text-zinc-500 shrink-0" />
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            aria-label="选择项目"
            className="flex-1 bg-transparent text-xs text-zinc-200 outline-none cursor-pointer"
          >
            {projects.map((p) => (
              <option key={p.project} value={p.project} className="bg-zinc-900">
                {p.name} ({p.doc_count})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {outline?.docs.map((doc) => (
          <div key={doc.id}>
            <div
              onClick={() => toggleDoc(doc)}
              role="button"
              tabIndex={0}
              aria-expanded={expandedDocId === doc.id}
              aria-label={`展开 ${doc.title}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDoc(doc) } }}
              className={`rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 hover:bg-zinc-900 transition-colors cursor-pointer ${
                expandedDocId === doc.id ? "border-blue-500/30" : ""
              }`}
            >
              <div className="flex items-start gap-2">
                <FileText size={13} className="text-blue-400/70 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-zinc-200 truncate">{doc.title}</div>
                  {doc.intent && (
                    <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-1">{doc.intent}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-zinc-600 font-mono">#{doc.id.slice(0, 8)}</span>
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.slice(0, 3).map((t) => (
                          <span key={t} className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500 bg-zinc-800 rounded px-1">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-1">
                    <code className="text-[10px] text-zinc-600 bg-zinc-800 rounded px-1 py-0.5">kb_read("{doc.id.slice(0, 8)}")</code>
                  </div>
                </div>
              </div>
            </div>
            {expandedDocId === doc.id && (
              <div className="mt-1 rounded-b-lg border border-t-0 border-zinc-800 bg-zinc-950 p-3">
                {expandedLoading ? (
                  <div className="text-xs text-zinc-500">Loading...</div>
                ) : (
                  <div className="markdown-body text-xs text-zinc-300">
                    <MarkdownRenderer content={expandedContent} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!outline?.docs?.length && (
          <div className="text-xs text-zinc-600 text-center py-4">
            {projects.length === 0 ? "No outlines found" : "Select a project"}
          </div>
        )}
      </div>
    </div>
  )
}
