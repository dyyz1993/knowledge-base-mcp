import { Plus, Trash2, MessageSquare } from "lucide-react"
import { useChatStore } from "../stores/chat"

export default function SessionList() {
  const { sessions, currentSessionId, createSession, deleteSession, switchSession } = useChatStore()

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b border-zinc-800">
        <button
          onClick={createSession}
          className="flex w-full items-center gap-2 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <Plus size={13} />
          <span>New Chat</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => switchSession(s.id)}
            className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
              s.id === currentSessionId
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
            }`}
          >
            <MessageSquare size={13} className="shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs truncate">{s.name}</div>
              <div className="text-[10px] text-zinc-600">
                {new Date(s.createdAt).toLocaleDateString()}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteSession(s.id)
              }}
              className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-all"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div className="text-xs text-zinc-600 text-center py-4">No sessions</div>
        )}
      </div>
    </div>
  )
}
