import { useState, useCallback } from "react"
import { Search, FileText } from "lucide-react"
import { Modal, Input, message } from "antd"
import { useChatStore } from "../../stores/chat"
import { writeKB } from "../../services/api"
import { SearchTab } from "./SearchTab"
import { OutlineTab } from "./OutlineTab"

type RightTab = "search" | "outline"

export default function KBPanel() {
  const { kbQuery, kbResults, searchKB, setKBQuery, kbSearching } = useChatStore()
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
      <div className="flex border-b border-zinc-800" role="tablist" aria-label="知识库面板">
        <button
          role="tab"
          aria-selected={activeTab === "search"}
          aria-controls="kb-panel-search"
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
          role="tab"
          aria-selected={activeTab === "outline"}
          aria-controls="kb-panel-outline"
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
        <div role="tabpanel" id="kb-panel-search">
        <SearchTab
          kbQuery={kbQuery}
          kbResults={kbResults}
          kbSearching={kbSearching}
          setKBQuery={setKBQuery}
          onSearch={handleSearch}
          onKey={handleKey}
          onWriteOpen={() => setWriteOpen(true)}
        />
        </div>
      ) : (
        <div role="tabpanel" id="kb-panel-outline">
          <OutlineTab />
        </div>
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
