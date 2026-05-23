import { useRef, useEffect } from "react"
import { Star, Pencil, Share2, Copy, Trash2 } from "lucide-react"
import { buildShareUrl } from "../../services/api"

export function SessionContextMenu({
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
      role="menu"
      aria-label="会话操作菜单"
      className="fixed z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ left: adjustedX, top: adjustedY }}
    >
      <button
        onClick={onFavorite}
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Star size={13} className={isFavorited ? "text-yellow-500 fill-yellow-500" : ""} />
        <span>{isFavorited ? "取消收藏" : "收藏会话"}</span>
      </button>
      <button
        onClick={onRename}
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Pencil size={13} />
        <span>重命名</span>
      </button>
      <button
        onClick={onShare}
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Share2 size={13} />
        <span>分享</span>
      </button>
      <button
        onClick={async () => {
          try {
            const url = buildShareUrl(sessionId)
            try { await navigator.clipboard.writeText(url) } catch {
              const ta = document.createElement("textarea")
              ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0"
              document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta)
            }
          } catch { /* ignore */ }
          onClose()
        }}
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        <Copy size={13} />
        <span>复制链接</span>
      </button>
      <div className="my-1 border-t border-zinc-700" role="separator" />
      <button
        onClick={onDelete}
        role="menuitem"
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 transition-colors"
      >
        <Trash2 size={13} />
        <span>删除</span>
      </button>
    </div>
  )
}
