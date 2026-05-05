import { useEffect, useState, useCallback } from "react"
import { Search, Command, MessageSquare, Database } from "lucide-react"
import { useDocStore } from "./stores/docs"
import { useChatStore } from "./stores/chat"
import Sidebar from "./components/Sidebar"
import DocViewer from "./components/DocViewer"
import SearchPalette from "./components/SearchPalette"
import ModelSelector from "./components/ModelSelector"
import SessionList from "./components/SessionList"
import ChatPanel from "./components/ChatPanel"
import KBPanel from "./components/KBPanel"
import FavoriteList from "./components/FavoriteList"

type Tab = "kb" | "chat"

export default function App() {
  const { docs, current, load, select } = useDocStore()
  const { loadSessions, loadModels, loadFavorites } = useChatStore()
  const [tab, setTab] = useState<Tab>("kb")
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()

  useEffect(() => { load() }, [])
  useEffect(() => { loadSessions(); loadModels(); loadFavorites() }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setSearchOpen(v => !v)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id)
    await select(id)
  }, [select])

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="h-10 border-b border-zinc-800 flex items-center px-4 shrink-0 bg-zinc-950">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab("kb")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === "kb" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Database size={13} />
            Knowledge Base
          </button>
          <button
            onClick={() => setTab("chat")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              tab === "chat" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <MessageSquare size={13} />
            Chat
          </button>
        </div>

        {tab === "chat" && <ModelSelector />}

        {tab === "kb" && (
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-auto flex items-center gap-2 px-3 py-1 rounded-md border border-zinc-800 text-xs text-zinc-500 hover:bg-zinc-900 transition-colors"
          >
            <Search size={13} />
            <span>Search</span>
            <kbd className="flex items-center gap-0.5 text-[10px] text-zinc-600">
              <Command size={10} />K
            </kbd>
          </button>
        )}
      </header>

      {tab === "kb" ? (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar docs={docs} selectedId={selectedId} onSelect={handleSelect} />
          <DocViewer doc={current} />
          <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={handleSelect} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-56 border-r border-zinc-800 flex flex-col shrink-0">
            <SessionList />
          </aside>
          <main className="flex-1 min-w-0">
            <ChatPanel />
          </main>
          <aside className="w-64 border-l border-zinc-800 flex flex-col shrink-0">
            <div className="flex border-b border-zinc-800">
              <div className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-zinc-400 border-b-2 border-transparent">
                <Database size={12} />
                <span>KB</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <KBPanel />
            </div>
            <div className="border-t border-zinc-800">
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-zinc-800">
                <span className="text-xs font-medium text-zinc-400">Favorites</span>
              </div>
              <div className="p-2 max-h-40 overflow-y-auto">
                <FavoriteList />
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
