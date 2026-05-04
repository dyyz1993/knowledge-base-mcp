const TAG_COLORS: Record<string, string> = {
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

export default function TagBadge({ tag }: { tag: string }) {
  const color = TAG_COLORS[tag] || "bg-zinc-800 text-zinc-400 border-zinc-600"
  return (
    <span className={`inline-block px-2 py-0.5 text-xs rounded border ${color}`}>
      {tag}
    </span>
  )
}
