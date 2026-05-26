import { useTheme } from "../theme"

const TAG_COLORS_DARK: Record<string, string> = {
  tutorial: "bg-blue-900/60 text-blue-300 border-blue-700",
  document: "bg-zinc-800 text-zinc-300 border-zinc-600",
  analysis: "bg-purple-900/60 text-purple-300 border-purple-700",
  guide: "bg-green-900/60 text-green-300 border-green-700",
  snippet: "bg-yellow-900/60 text-yellow-300 border-yellow-700",
  "best-practice": "bg-emerald-900/60 text-emerald-300 border-emerald-700",
  reference: "bg-cyan-900/60 text-cyan-300 border-cyan-700",
  architecture: "bg-orange-900/60 text-orange-300 border-orange-700",
  troubleshooting: "bg-red-900/60 text-red-300 border-red-700",
  decision: "bg-pink-900/60 text-pink-300 border-pink-700",
}

const TAG_COLORS_LIGHT: Record<string, string> = {
  tutorial: "bg-blue-50 text-blue-600 border-blue-200",
  document: "bg-gray-100 text-gray-600 border-gray-300",
  analysis: "bg-purple-50 text-purple-600 border-purple-200",
  guide: "bg-green-50 text-green-600 border-green-200",
  snippet: "bg-yellow-50 text-yellow-700 border-yellow-200",
  "best-practice": "bg-emerald-50 text-emerald-600 border-emerald-200",
  reference: "bg-cyan-50 text-cyan-600 border-cyan-200",
  architecture: "bg-orange-50 text-orange-600 border-orange-200",
  troubleshooting: "bg-red-50 text-red-600 border-red-200",
  decision: "bg-pink-50 text-pink-600 border-pink-200",
}

export default function TagBadge({ tag }: { tag: string }) {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  const colors = isDark ? TAG_COLORS_DARK : TAG_COLORS_LIGHT
  const color = colors[tag] || (isDark ? "bg-zinc-800 text-zinc-400 border-zinc-600" : "bg-gray-100 text-gray-500 border-gray-300")
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded border ${color}`}>
      {tag}
    </span>
  )
}
