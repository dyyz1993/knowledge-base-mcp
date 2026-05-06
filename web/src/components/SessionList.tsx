import { Plus, Trash2, MessageSquare, Loader2 } from "lucide-react"
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
          <SessionItem
            key={s.id}
            session={s}
            isActive={s.id === currentSessionId}
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

function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: {
  session: { id: string; name: string; createdAt: number }
  isActive: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const streamState = useChatStore((s) => s.streamStates.get(session.id))
  const running = streamState?.isStreaming ?? false

  return (
    <div
      onClick={() => onSelect(session.id)}
      className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
        isActive
          ? "bg-zinc-800 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      } ${running ? "ring-1 ring-blue-500/30" : ""}`}
    >
      <MessageSquare size={13} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate">{session.name}</div>
        <div className="text-[10px] text-zinc-600">
          {new Date(session.createdAt).toLocaleDateString()}
        </div>
      </div>
      {running && (
        <span className="flex items-center gap-1 text-[10px] text-blue-400 shrink-0">
          <Loader2 size={10} className="animate-spin" />
          运行中
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(session.id)
        }}
        className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-all"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}
