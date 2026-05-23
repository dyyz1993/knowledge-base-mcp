import { Star, Trash2 } from "lucide-react"
import { useChatStore } from "../stores/chat"

export default function FavoriteList() {
  const { favorites, removeFavorite } = useChatStore()

  return (
    <div className="space-y-1" role="list" aria-label="收藏列表">
      {favorites.map((fav) => (
        <div
          key={fav.id}
          role="listitem"
          className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 hover:bg-zinc-900 transition-colors"
        >
          <div className="flex items-start gap-2">
            <Star size={12} className="text-yellow-600 shrink-0 mt-0.5" />
            <p className="flex-1 text-xs text-zinc-300 line-clamp-3">{fav.content}</p>
            <button
              onClick={() => removeFavorite(fav.id)}
              aria-label="删除收藏"
              className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400 transition-all"
            >
              <Trash2 size={11} />
            </button>
          </div>
          <div className="text-[10px] text-zinc-600 mt-1">
            {new Date(fav.createdAt).toLocaleString()}
          </div>
        </div>
      ))}
      {favorites.length === 0 && (
        <div className="text-xs text-zinc-600 text-center py-3">No favorites yet</div>
      )}
    </div>
  )
}
