import { useState, useEffect, useRef, useCallback } from "react"
import { Plus, Trash2, MessageSquare, Loader2, Star, Share2, Pencil, Copy } from "lucide-react"
import { useChatStore } from "../stores/chat"

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

function SessionItem({
  session,
  isActive,
  isFavorited,
  onSelect,
  onDelete,
}: {
  session: { id: string; name: string; createdAt: number }
  isActive: boolean
  isFavorited: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
}) {
  const streamState = useChatStore((s) => s.streamStates.get(session.id))
  const toggleSessionFavorite = useChatStore((s) => s.toggleSessionFavorite)
  const renameSessionLocal = useChatStore((s) => s.renameSessionLocal)
  const running = streamState?.isStreaming ?? false

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus()
      editRef.current.select()
    }
  }, [editing])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(session.name)
    setEditing(true)
  }, [session.name])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== session.name) {
      renameSessionLocal(session.id, trimmed)
    }
    setEditing(false)
  }, [editValue, session.id, session.name, renameSessionLocal])

  const handleRenameKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleRenameSubmit()
    } else if (e.key === "Escape") {
      setEditing(false)
    }
  }, [handleRenameSubmit])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const copyText = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement("textarea")
      ta.value = text
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      document.body.removeChild(ta)
    }
  }, [])

  const handleShare = useCallback(async () => {
    setContextMenu(null)
    try {
      const { buildShareUrl } = await import("../services/api")
      const url = buildShareUrl(session.id)
      await copyText(url)
      setToast("已复制分享链接")
    } catch {
      setToast("分享失败")
    }
  }, [session.id, copyText])

  const handleFavorite = useCallback(() => {
    setContextMenu(null)
    toggleSessionFavorite(session.id)
  }, [session.id, toggleSessionFavorite])

  const handleRename = useCallback(() => {
    setContextMenu(null)
    setEditValue(session.name)
    setEditing(true)
  }, [session.name])

  const handleDelete = useCallback(() => {
    setContextMenu(null)
    onDelete(session.id)
  }, [onDelete, session.id])

  return (
    <>
      <div
        onClick={() => { if (!editing) onSelect(session.id) }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors relative ${
          isActive
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        } ${running ? "ring-1 ring-blue-500/30" : ""}`}
      >
        <MessageSquare size={13} className="shrink-0" />
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={editRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKey}
              className="w-full bg-zinc-700 text-xs text-zinc-100 px-1 py-0.5 rounded outline-none border border-zinc-600 focus:border-blue-500"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="text-xs truncate">{session.name}</div>
          )}
          <div className="text-[10px] text-zinc-600 flex items-center gap-1">
            <span>{new Date(session.createdAt).toLocaleDateString()}</span>
            {isFavorited && <Star size={9} className="text-yellow-500 fill-yellow-500" />}
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
        {toast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-zinc-700 text-xs text-zinc-100 whitespace-nowrap z-[100] shadow-xl border border-zinc-600">
            {toast}
          </div>
        )}
      </div>

      {contextMenu && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sessionId={session.id}
          isFavorited={isFavorited}
          onFavorite={handleFavorite}
          onRename={handleRename}
          onShare={handleShare}
          onDelete={handleDelete}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

function SessionContextMenu({
  x,
  y,
  sessionId,
  isFavorited,
  onFavorite,
  onRename,
  onShare,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  sessionId: string
  isFavorited: boolean
  onFavorite: () => void
  onRename: () => void
  onShare: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("mousedown", handleClick)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handleClick)
      document.removeEventListener("keydown", handleKey)
    }
  }, [onClose])

  const menuHeight = 180
  const menuWidth = 160
  const adjustedX = x + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 8 : x
  const adjustedY = y + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 8 : y

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <button
        onClick={onFavorite}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Star size={13} className={isFavorited ? "text-yellow-500 fill-yellow-500" : ""} />
        <span>{isFavorited ? "取消收藏" : "收藏会话"}</span>
      </button>
      <button
        onClick={onRename}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Pencil size={13} />
        <span>重命名</span>
      </button>
      <button
        onClick={onShare}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Share2 size={13} />
        <span>分享</span>
      </button>
      <button
        onClick={async () => {
          try {
            const { buildShareUrl } = await import("../services/api")
            const url = buildShareUrl(sessionId)
            try { await navigator.clipboard.writeText(url) } catch {
              const ta = document.createElement("textarea")
              ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0"
              document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta)
            }
          } catch { /* ignore */ }
          onClose()
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Copy size={13} />
        <span>复制链接</span>
      </button>
      <div className="my-1 border-t border-zinc-700" />
      <button
        onClick={onDelete}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 transition-colors"
      >
        <Trash2 size={13} />
        <span>删除</span>
      </button>
    </div>
  )
}
