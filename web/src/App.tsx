import { useEffect, useState, useCallback } from "react"
import { Search, Command } from "lucide-react"
import { useDocStore } from "./stores/docs"
import Sidebar from "./components/Sidebar"
import DocViewer from "./components/DocViewer"
import SearchPalette from "./components/SearchPalette"

export default function App() {
  const { docs, current, load, select } = useDocStore()
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()

  useEffect(() => { load() }, [])

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
    <div className="h-screen flex flex-col">
      <header className="h-10 border-b border-zinc-800 flex items-center px-4 shrink-0 bg-zinc-950">
        <span className="text-sm font-medium text-zinc-400">Knowledge Base</span>
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
      </header>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar docs={docs} selectedId={selectedId} onSelect={handleSelect} />
        <DocViewer doc={current} />
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={handleSelect} />
    </div>
  )
}
