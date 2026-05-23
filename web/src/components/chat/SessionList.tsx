import { Plus } from "lucide-react"
import { useChatStore } from "../../stores/chat"
import { SessionItem } from "./SessionItem"

export default function SessionList() {
  const sessions = useChatStore((s) => s.sessions)
  const sessionFavorites = useChatStore((s) => s.sessionFavorites)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const createSession = useChatStore((s) => s.createSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const switchSession = useChatStore((s) => s.switchSession)

  const sorted = [...sessions].sort((a, b) => {
    const aFav = sessionFavorites.includes(a.id) ? 0 : 1
    const bFav = sessionFavorites.includes(b.id) ? 0 : 1
    if (aFav !== bFav) return aFav - bFav
    return b.createdAt - a.createdAt
  })

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-zinc-800">
        <button
          onClick={createSession}
          aria-label="新建会话"
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <Plus size={13} />
          <span>New Chat</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {sorted.map((s) => (
          <SessionItem
            key={s.id}
            session={s}
            isActive={s.id === currentSessionId}
            isFavorited={sessionFavorites.includes(s.id)}
            onSelect={switchSession}
            onDelete={deleteSession}
          />
        ))}
        {sessions.length === 0 && (
          <div className="text-xs text-zinc-600 text-center py-4">No sessions</div>
        )}
      </div>
    </div>
  )
}
