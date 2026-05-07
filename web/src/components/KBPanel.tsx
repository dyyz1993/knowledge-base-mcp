import { useState, useCallback, useEffect } from "react"
import { Search, FileText, Tag, Plus, ChevronDown, ChevronRight, FolderOpen } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Modal, Input, message } from "antd"
import { useChatStore } from "../stores/chat"
import { writeKB, fetchOutlines, fetchOutline, readDoc } from "../services/api"
import type { OutlineProject, OutlineDoc, Outline } from "../services/api"
import CopyButton from "./CopyButton"

type RightTab = "search" | "outline"

export default function KBPanel() {
  const { kbQuery, kbResults, searchKB, setKBQuery } = useChatStore()
  const [activeTab, setActiveTab] = useState<RightTab>("search")
  const [writeOpen, setWriteOpen] = useState(false)
  const [writeForm, setWriteForm] = useState({ title: "", content: "", tags: "", keywords: "", intent: "" })

  const handleSearch = useCallback(() => {
    searchKB(kbQuery)
  }, [kbQuery, searchKB])

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch()
  }, [handleSearch])

  const handleWrite = useCallback(async () => {
    if (!writeForm.title || !writeForm.content) return
    try {
      await writeKB({
        title: writeForm.title,
        content: writeForm.content,
        tags: writeForm.tags.split(",").map((s) => s.trim()).filter(Boolean),
        keywords: writeForm.keywords.split(",").map((s) => s.trim()).filter(Boolean),
        intent: writeForm.intent,
      })
      message.success("Document saved")
      setWriteOpen(false)
      setWriteForm({ title: "", content: "", tags: "", keywords: "", intent: "" })
    } catch {
      message.error("Failed to save")
    }
  }, [writeForm])

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-zinc-800">
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
            activeTab === "search"
              ? "text-zinc-200 border-b-2 border-blue-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          onClick={() => setActiveTab("search")}
        >
          <Search size={12} />
          搜索
        </button>
        <button
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium transition-colors ${
            activeTab === "outline"
              ? "text-zinc-200 border-b-2 border-blue-500"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          onClick={() => setActiveTab("outline")}
        >
          <FileText size={12} />
          大纲
        </button>
      </div>

      {activeTab === "search" ? (
        <SearchTab
          kbQuery={kbQuery}
          kbResults={kbResults}
          setKBQuery={setKBQuery}
          onSearch={handleSearch}
          onKey={handleKey}
          onWriteOpen={() => setWriteOpen(true)}
        />
      ) : (
        <OutlineTab />
      )}

      <Modal
        title="Write to Knowledge Base"
        open={writeOpen}
        onOk={handleWrite}
        onCancel={() => setWriteOpen(false)}
        okText="Save"
        width={500}
      >
        <div className="space-y-3 py-2">
          <Input
            placeholder="Title"
            value={writeForm.title}
            onChange={(e) => setWriteForm({ ...writeForm, title: e.target.value })}
          />
          <Input.TextArea
            placeholder="Content (Markdown)"
            value={writeForm.content}
            onChange={(e) => setWriteForm({ ...writeForm, content: e.target.value })}
            rows={6}
          />
          <Input
            placeholder="Tags (comma separated)"
            value={writeForm.tags}
            onChange={(e) => setWriteForm({ ...writeForm, tags: e.target.value })}
          />
          <Input
            placeholder="Keywords (comma separated)"
            value={writeForm.keywords}
            onChange={(e) => setWriteForm({ ...writeForm, keywords: e.target.value })}
          />
          <Input
            placeholder="Intent (brief description)"
            value={writeForm.intent}
            onChange={(e) => setWriteForm({ ...writeForm, intent: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  )
}

interface KBDocResult {
  id: string
  title: string
  tags?: string[]
  keywords?: string[]
  intent?: string
  score?: number
  snippet?: string
}

function SearchTab({
  kbQuery,
  kbResults,
  setKBQuery,
  onSearch,
  onKey,
  onWriteOpen,
}: {
  kbQuery: string
  kbResults: KBDocResult[]
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
              className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
            />
          </div>
          <button
            onClick={onSearch}
            className="shrink-0 rounded-lg bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Go
          </button>
        </div>
        <button
          onClick={onWriteOpen}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors"
        >
          <Plus size={12} />
          <span>Write to KB</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {kbResults.map((doc) => (
          <div key={doc.id}>
            <div
              onClick={() => toggleExpand(doc.id)}
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
                  <div className="text-xs text-zinc-500">Loading...</div>
                ) : (
                  <div className="markdown-body text-xs text-zinc-300">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{expandedContent}</ReactMarkdown>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {kbQuery && kbResults.length === 0 && (
          <div className="text-xs text-zinc-600 text-center py-4">No results</div>
        )}
        {!kbQuery && (
          <div className="text-xs text-zinc-600 text-center py-4">Search to find documents</div>
        )}
      </div>
    </>
  )
}

function OutlineTab() {
  const [projects, setProjects] = useState<OutlineProject[]>([])
  const [selectedProject, setSelectedProject] = useState<string>("")
  const [outline, setOutline] = useState<Outline | null>(null)
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<string>("")
  const [expandedLoading, setExpandedLoading] = useState(false)

  useEffect(() => {
    fetchOutlines().then(setProjects).catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedProject) {
      if (projects.length > 0) {
        setSelectedProject(projects[0].project)
      }
      return
    }
    fetchOutline(selectedProject).then(setOutline).catch(() => setOutline(null))
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{expandedContent}</ReactMarkdown>
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
