import { Select, InputNumber, Slider } from "antd"
import { Search } from "lucide-react"
import { SEARCH_MODES } from "./constants"
import type { SearchConfig } from "../../services/api"
import { useTheme } from "../../theme"

interface SearchSectionProps {
  search: SearchConfig
  onUpdateSearch: <K extends keyof SearchConfig>(key: K, value: SearchConfig[K]) => void
  onUpdateWeight: (key: keyof SearchConfig["weights"], value: number) => void
}

export function SearchSection({ search, onUpdateSearch, onUpdateWeight }: SearchSectionProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  const normalizedWeights = {
    token: search.weights.token * 100,
    tfidf: search.weights.tfidf * 100,
    semantic: search.weights.semantic * 100,
  }

  return (
    <section className={`rounded-lg border p-4 space-y-4 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-white"}`}>
      <div className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-gray-500"}`}>
        <Search size={13} className={isDark ? "text-zinc-500" : "text-gray-400"} />
        Search
      </div>

      <div className="space-y-1.5">
        <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Search Mode</label>
        <Select
          value={search.mode}
          options={[...SEARCH_MODES]}
          onChange={v => onUpdateSearch("mode", v)}
          className="w-full"
          size="small"
        />
      </div>

      <div className="space-y-1.5">
        <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Min Score Threshold</label>
        <InputNumber
          size="small"
          min={0}
          max={100}
          step={0.5}
          value={search.minScore}
          onChange={v => v != null && onUpdateSearch("minScore", v)}
          className="w-full"
        />
      </div>

      {search.mode === "combined" && (
        <div className="space-y-3">
          <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Weights</label>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className={`text-[11px] w-14 shrink-0 ${isDark ? "text-zinc-500" : "text-gray-400"}`}>Token</span>
              <Slider
                min={0}
                max={100}
                value={normalizedWeights.token}
                onChange={v => onUpdateWeight("token", v / 100)}
                className="flex-1"
                styles={{ track: { background: "#3b82f6" } }}
              />
              <span className={`text-[11px] w-8 text-right ${isDark ? "text-zinc-500" : "text-gray-400"}`}>{normalizedWeights.token}%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-[11px] w-14 shrink-0 ${isDark ? "text-zinc-500" : "text-gray-400"}`}>TF-IDF</span>
              <Slider
                min={0}
                max={100}
                value={normalizedWeights.tfidf}
                onChange={v => onUpdateWeight("tfidf", v / 100)}
                className="flex-1"
                styles={{ track: { background: "#8b5cf6" } }}
              />
              <span className={`text-[11px] w-8 text-right ${isDark ? "text-zinc-500" : "text-gray-400"}`}>{normalizedWeights.tfidf}%</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-[11px] w-14 shrink-0 ${isDark ? "text-zinc-500" : "text-gray-400"}`}>Semantic</span>
              <Slider
                min={0}
                max={100}
                value={normalizedWeights.semantic}
                onChange={v => onUpdateWeight("semantic", v / 100)}
                className="flex-1"
                styles={{ track: { background: "#10b981" } }}
              />
              <span className={`text-[11px] w-8 text-right ${isDark ? "text-zinc-500" : "text-gray-400"}`}>{normalizedWeights.semantic}%</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
