import { useState, useCallback } from "react"
import { Search, FileText, Tag, Plus } from "lucide-react"
import { Modal, Input, message } from "antd"
import { useChatStore } from "../stores/chat"
import { writeKB } from "../services/api"

export default function KBPanel() {
  const { kbQuery, kbResults, searchKB, setKBQuery } = useChatStore()
  const [writeOpen, setWriteOpen] = useState(false)
  const [writeForm, setWriteForm] = useState({ title: "", content: "", tags: "", keywords: "" })

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
      })
      message.success("Document saved")
      setWriteOpen(false)
      setWriteForm({ title: "", content: "", tags: "", keywords: "" })
    } catch {
      message.error("Failed to save")
    }
  }, [writeForm])

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-zinc-800 space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5">
            <Search size={13} className="text-zinc-500 shrink-0" />
            <input
              value={kbQuery}
              onChange={(e) => setKBQuery(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Search knowledge base..."
              className="flex-1 bg-transparent text-xs text-zinc-200 placeholder-zinc-600 outline-none"
            />
          </div>
          <button
            onClick={handleSearch}
            className="shrink-0 rounded-lg bg-zinc-800 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Go
          </button>
        </div>
        <button
          onClick={() => setWriteOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors"
        >
          <Plus size={12} />
          <span>Write to KB</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {kbResults.map((doc) => (
          <div
            key={doc.id}
            className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-2.5 hover:bg-zinc-900 transition-colors"
          >
            <div className="flex items-start gap-2">
              <FileText size={13} className="text-zinc-500 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-200 truncate">{doc.title}</div>
                {doc.snippet && (
                  <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{doc.snippet}</p>
                )}
                {doc.tags && doc.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {doc.tags.map((t) => (
                      <span key={t} className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500">
                        <Tag size={9} />
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {kbQuery && kbResults.length === 0 && (
          <div className="text-xs text-zinc-600 text-center py-4">No results</div>
        )}
        {!kbQuery && (
          <div className="text-xs text-zinc-600 text-center py-4">Search to find documents</div>
        )}
      </div>

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
        </div>
      </Modal>
    </div>
  )
}
