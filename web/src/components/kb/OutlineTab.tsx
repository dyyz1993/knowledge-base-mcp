import { useState, useEffect, useCallback } from "react"
import { FileText, FolderOpen, Loader2 } from "lucide-react"
import { Spin } from "antd"
import { fetchOutlines, fetchOutline, readDoc } from "../../services/api"
import type { OutlineProject, OutlineDoc, Outline } from "../../services/api"
import { MarkdownRenderer } from "../MarkdownRenderer"
import { useTheme } from "../../theme"

export function OutlineTab() {
  const [projects, setProjects] = useState<OutlineProject[]>([])
  const [selectedProject, setSelectedProject] = useState<string>("")
  const [outline, setOutline] = useState<Outline | null>(null)
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<string>("")
  const [expandedLoading, setExpandedLoading] = useState(false)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [outlineLoading, setOutlineLoading] = useState(false)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  useEffect(() => {
    ;(async () => {
      setProjectsLoading(true)
      try { const data = await fetchOutlines(); setProjects(data) } catch (e) { if (import.meta.env.DEV) console.warn('[KBPanel] fetchOutlines failed:', e) }
      finally { setProjectsLoading(false) }
    })()
  }, [])

  useEffect(() => {
    if (!selectedProject) {
      if (projects.length > 0) {
        setSelectedProject(projects[0].project)
      }
      return
    }
    ;(async () => { setOutlineLoading(true); try { const data = await fetchOutline(selectedProject); setOutline(data) } catch { setOutline(null) } finally { setOutlineLoading(false) } })()
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
      <div className={`p-2 border-b ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${isDark ? "border-zinc-700 bg-zinc-900" : "border-gray-300 bg-white"}`}>
          <FolderOpen size={13} className={`${isDark ? "text-zinc-500" : "text-gray-400"} shrink-0`} />
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            aria-label="选择项目"
            className={`flex-1 bg-transparent text-xs outline-none cursor-pointer ${isDark ? "text-zinc-200" : "text-gray-800"}`}
          >
            {projects.map((p) => (
              <option key={p.project} value={p.project} className={isDark ? "bg-zinc-900" : "bg-white"}>
                {p.name} ({p.doc_count})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {(projectsLoading || outlineLoading) && (
          <div className={`flex items-center justify-center gap-2 py-6 text-xs ${isDark ? "text-zinc-500" : "text-gray-500"}`}>
            <Spin size="small" />
            <span>{projectsLoading ? "Loading projects..." : "Loading outline..."}</span>
          </div>
        )}
        {!projectsLoading && !outlineLoading && outline?.docs.map((doc) => (
          <div key={doc.id}>
            <div
              onClick={() => toggleDoc(doc)}
              role="button"
              tabIndex={0}
              aria-expanded={expandedDocId === doc.id}
              aria-label={`展开 ${doc.title}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleDoc(doc) } }}
              className={`rounded-lg border p-2.5 transition-colors cursor-pointer ${isDark ? "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900" : "border-gray-200 bg-white hover:bg-gray-50"} ${
                expandedDocId === doc.id ? "border-blue-500/30" : ""
              }`}
            >
              <div className="flex items-start gap-2">
                <FileText size={13} className="text-blue-400/70 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className={`text-xs font-medium truncate ${isDark ? "text-zinc-200" : "text-gray-800"}`}>{doc.title}</div>
                  {doc.intent && (
                    <p className={`text-[10px] mt-0.5 line-clamp-1 ${isDark ? "text-zinc-500" : "text-gray-500"}`}>{doc.intent}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] font-mono ${isDark ? "text-zinc-600" : "text-gray-400"}`}>#{doc.id.slice(0, 8)}</span>
                    {doc.tags && doc.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {doc.tags.slice(0, 3).map((t) => (
                          <span key={t} className={`inline-flex items-center gap-0.5 text-[10px] rounded px-1 ${isDark ? "text-zinc-500 bg-zinc-800" : "text-gray-500 bg-gray-100"}`}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="mt-1">
                    <code className={`text-[10px] rounded px-1 py-0.5 ${isDark ? "text-zinc-600 bg-zinc-800" : "text-gray-500 bg-gray-100"}`}>kb_read("{doc.id.slice(0, 8)}")</code>
                  </div>
                </div>
              </div>
            </div>
            {expandedDocId === doc.id && (
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
        {!projectsLoading && !outlineLoading && !outline?.docs?.length && (
          <div className={`text-xs text-center py-4 ${isDark ? "text-zinc-600" : "text-gray-400"}`}>
            {projects.length === 0 ? "No outlines found" : "Select a project"}
          </div>
        )}
      </div>
    </div>
  )
}
