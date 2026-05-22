import { Input, Switch } from "antd"
import { Sparkles } from "lucide-react"

interface WebSearchSectionProps {
  enabled: boolean
  apiKey: string
  showKey: boolean
  onEnabledChange: (v: boolean) => void
  onApiKeyChange: (v: string) => void
}

export function WebSearchSection({ enabled, apiKey, showKey, onEnabledChange, onApiKeyChange }: WebSearchSectionProps) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
        <Sparkles size={13} className="text-amber-500" />
        Web Search（联网搜索）
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-zinc-400">启用联网搜索</span>
          <p className="text-[10px] text-zinc-600">Ask Tab 未命中 KB 时自动联网搜索</p>
        </div>
        <Switch
          size="small"
          checked={enabled}
          onChange={onEnabledChange}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-zinc-400">API Key（智谱）</label>
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
        <span className="text-[11px] text-zinc-600">用于 Ask Tab 的联网搜索功能，不填则关闭联网能力</span>
      </div>
    </section>
  )
}
