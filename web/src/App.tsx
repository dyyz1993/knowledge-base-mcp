import { useEffect, useState, useCallback } from "react"
import { Search, Command, MessageSquare, Database, Menu, Settings } from "lucide-react"
import { useDocStore } from "./stores/docs"
import { useChatStore } from "./stores/chat"
import Sidebar from "./components/Sidebar"
import DocViewer from "./components/DocViewer"
import SearchPalette from "./components/SearchPalette"
import SessionList from "./components/SessionList"
import ChatPanel from "./components/ChatPanel"
import KBPanel from "./components/KBPanel"
import FavoriteList from "./components/FavoriteList"
import SettingsPanel from "./components/SettingsPanel"

type Tab = "kb" | "chat"

export default function App() {
  const { docs, current, load, select } = useDocStore()
  const { loadSessions, loadModels, loadFavorites } = useChatStore()
  const [tab, setTab] = useState<Tab>("kb")
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

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

  const currentSessionName = useChatStore((s) => {
    const sess = s.sessions.find(x => x.id === s.currentSessionId)
    return sess?.name || ""
  })

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="h-10 border-b border-zinc-800 flex items-center px-3 md:px-4 shrink-0 bg-zinc-950 gap-2">
        {tab === "chat" && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden shrink-0 p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Menu size={18} />
          </button>
        )}
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

        {tab === "chat" && (
          <span className="hidden lg:inline-flex text-xs text-zinc-500 truncate max-w-[200px]">{currentSessionName}</span>
        )}

        {tab === "kb" && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 px-3 py-1 rounded-md border border-zinc-800 text-xs text-zinc-500 hover:bg-zinc-900 transition-colors"
            >
              <Search size={13} />
              <span>Search</span>
              <kbd className="flex items-center gap-0.5 text-[10px] text-zinc-600">
                <Command size={10} />K
              </kbd>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <Settings size={14} />
            </button>
          </div>
        )}
      </header>

      {tab === "kb" ? (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar docs={docs} selectedId={selectedId} onSelect={handleSelect} />
          <DocViewer doc={current} />
          <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={handleSelect} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden relative">
          {sidebarOpen && (
            <div
              className="fixed inset-0 top-10 z-20 bg-black/50 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          <aside className={`
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            fixed top-10 bottom-0 left-0 z-30 w-64 sm:w-56
            lg:translate-x-0 lg:relative lg:top-0 lg:w-56 xl:w-60
            transition-transform duration-200 ease-in-out
            border-r border-zinc-800 flex flex-col shrink-0 bg-zinc-950
          `}>
            <SessionList />
            <div className="p-2 border-t border-zinc-800">
              <button
                onClick={() => setSettingsOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
              >
                <Settings size={13} />
                <span>Settings</span>
              </button>
            </div>
          </aside>

          <main className="flex-1 min-w-0 flex flex-col">
            {tab === "chat" && (
              <header className="flex items-center gap-3 p-3 border-b border-zinc-800 lg:hidden shrink-0">
                <span className="text-sm font-medium truncate">{currentSessionName}</span>
              </header>
            )}
            <ChatPanel />
          </main>

          <aside className="hidden xl:flex w-64 border-l border-zinc-800 flex-col shrink-0 flex-col">
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

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
