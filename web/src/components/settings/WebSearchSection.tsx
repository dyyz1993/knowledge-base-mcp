import { Input, Switch } from "antd"
import { Sparkles } from "lucide-react"
import { useTheme } from "../../theme"

interface WebSearchSectionProps {
  enabled: boolean
  apiKey: string
  showKey: boolean
  onEnabledChange: (v: boolean) => void
  onApiKeyChange: (v: string) => void
}

export function WebSearchSection({ enabled, apiKey, showKey, onEnabledChange, onApiKeyChange }: WebSearchSectionProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"

  return (
    <section className={`rounded-lg border p-4 space-y-4 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-white"}`}>
      <div className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-gray-500"}`}>
        <Sparkles size={13} className="text-amber-500" />
        Web Search（联网搜索）
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>启用联网搜索</span>
          <p className={`text-[10px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>Ask Tab 未命中 KB 时自动联网搜索</p>
        </div>
        <Switch
          size="small"
          checked={enabled}
          onChange={onEnabledChange}
        />
      </div>

      <div className="space-y-1.5">
        <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>API Key（智谱）</label>
        <div className="flex gap-1.5">
          <Input
            size="small"
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={e => onApiKeyChange(e.target.value)}
            placeholder="智谱 API Key（用于 web-search-prime / web-reader）"
            className="flex-1"
          />
        </div>
        <span className={`text-[11px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>用于 Ask Tab 的联网搜索功能，不填则关闭联网能力</span>
      </div>
    </section>
  )
}
