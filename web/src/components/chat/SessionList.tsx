import { Plus } from "lucide-react"
import { Empty } from "antd"
import { useChatStore } from "../../stores/chat"
import { SessionItem } from "./SessionItem"
import { useTheme } from "../../theme"

export default function SessionList() {
  const sessions = useChatStore((s) => s.sessions)
  const sessionFavorites = useChatStore((s) => s.sessionFavorites)
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const createSession = useChatStore((s) => s.createSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const switchSession = useChatStore((s) => s.switchSession)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const sorted = [...sessions].sort((a, b) => {
    const aFav = sessionFavorites.includes(a.id) ? 0 : 1
    const bFav = sessionFavorites.includes(b.id) ? 0 : 1
    if (aFav !== bFav) return aFav - bFav
    return b.createdAt - a.createdAt
  })

  return (
    <div className="flex flex-col h-full">
      <div className={`p-2 border-b ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <button
          onClick={createSession}
          aria-label="新建会话"
          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors ${isDark ? "border-zinc-700 text-zinc-300 hover:bg-zinc-800" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
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
          <div className="py-8">
            <Empty description={<span className={`text-xs ${isDark ? "text-zinc-500" : "text-gray-500"}`}>暂无会话</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        )}
      </div>
    </div>
  )
}
