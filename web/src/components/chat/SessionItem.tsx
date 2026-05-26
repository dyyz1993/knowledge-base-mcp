import { useState, useEffect, useRef, useCallback } from "react"
import { Trash2, MessageSquare, Loader2, Star } from "lucide-react"
import { message } from "antd"
import { useChatStore } from "../../stores/chat"
import { buildShareUrl } from "../../services/api"
import { SessionContextMenu } from "./SessionContextMenu"
import { useTheme } from "../../theme"

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
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const editRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus()
      editRef.current.select()
    }
  }, [editing])

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
      message.success("已复制分享链接")
    } catch {
      message.error("分享失败")
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
            ? (isDark ? "bg-zinc-800 text-zinc-100" : "bg-gray-200 text-gray-900")
            : (isDark ? "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200" : "text-gray-600 hover:bg-gray-100 hover:text-gray-800")
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
              className={`w-full text-xs px-1 py-0.5 rounded outline-none border focus:border-blue-500 ${isDark ? "bg-zinc-700 text-zinc-100 border-zinc-600" : "bg-gray-100 text-gray-900 border-gray-300"}`}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="text-xs truncate">{session.name}</div>
          )}
          <div className={`text-[10px] flex items-center gap-1 ${isDark ? "text-zinc-600" : "text-gray-400"}`}>
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
          className={`shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded transition-all ${isDark ? "hover:bg-zinc-700 text-zinc-500 hover:text-red-400" : "hover:bg-gray-200 text-gray-400 hover:text-red-500"}`}
          aria-label="Delete session"
        >
          <Trash2 size={12} />
        </button>
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
