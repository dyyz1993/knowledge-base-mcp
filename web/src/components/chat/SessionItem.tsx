import { useState, useEffect, useRef, useCallback } from "react"
import { Trash2, MessageSquare, Loader2, Star } from "lucide-react"
import { useChatStore } from "../../stores/chat"
import { buildShareUrl } from "../../services/api"
import { SessionContextMenu } from "./SessionContextMenu"

export function SessionItem({
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
    if (!window.confirm("确定删除此会话？此操作不可恢复。")) return
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
              aria-label="编辑会话名称"
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
            if (!window.confirm("确定删除此会话？此操作不可恢复。")) return
            onDelete(session.id)
          }}
          className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-all"
          aria-label="Delete session"
        >
          <Trash2 size={12} />
        </button>
        {toast && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-zinc-700 text-xs text-zinc-100 whitespace-nowrap z-[100] shadow-xl border border-zinc-600" role="status" aria-live="polite">
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
