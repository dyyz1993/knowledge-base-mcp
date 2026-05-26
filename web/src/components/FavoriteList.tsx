import { Star, Trash2 } from "lucide-react"
import { useChatStore } from "../stores/chat"
import { useTheme } from "../theme"

export default function FavoriteList() {
  const { favorites, removeFavorite } = useChatStore()
  const { theme } = useTheme()
  const isDark = theme === "dark"

  return (
    <div className="space-y-1" role="list" aria-label="收藏列表">
      {favorites.map((fav) => (
        <div
          key={fav.id}
          role="listitem"
          className={`group rounded-lg border p-2 transition-colors ${isDark ? "border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900" : "border-gray-200 bg-white hover:bg-gray-50"}`}
        >
          <div className="flex items-start gap-2">
            <Star size={12} className="text-yellow-600 shrink-0 mt-0.5" />
            <p className={`flex-1 text-xs line-clamp-3 ${isDark ? "text-zinc-300" : "text-gray-700"}`}>{fav.content}</p>
            <button
              onClick={() => removeFavorite(fav.id)}
              aria-label="删除收藏"
              className={`shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded transition-all ${isDark ? "hover:bg-zinc-700 text-zinc-500 hover:text-red-400" : "hover:bg-gray-200 text-gray-400 hover:text-red-500"}`}
            >
              <Trash2 size={11} />
            </button>
          </div>
          <div className={`text-[10px] mt-1 ${isDark ? "text-zinc-600" : "text-gray-400"}`}>
            {new Date(fav.createdAt).toLocaleString()}
          </div>
        </div>
      ))}
      {favorites.length === 0 && (
        <div className={`text-xs text-center py-3 ${isDark ? "text-zinc-600" : "text-gray-400"}`}>No favorites yet</div>
      )}
    </div>
  )
}
