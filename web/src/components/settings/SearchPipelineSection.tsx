import { Input, InputNumber, Switch, Tag } from "antd"
import { Layers } from "lucide-react"
import { XBrowserEngineOptions } from "./constants"
import type { SearchPipelineConfig, XBrowserEngine } from "../../services/api"
import { useTheme } from "../../theme"

interface SearchPipelineSectionProps {
  sp: SearchPipelineConfig
  onUpdateSP: <K extends keyof SearchPipelineConfig>(key: K, value: SearchPipelineConfig[K]) => void
  onUpdateSPSource: <K extends keyof SearchPipelineConfig["sources"]>(key: K, value: Partial<SearchPipelineConfig["sources"][K]>) => void
}

export function SearchPipelineSection({ sp, onUpdateSP, onUpdateSPSource }: SearchPipelineSectionProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"

  return (
    <section className={`rounded-lg border p-4 space-y-4 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-white"}`}>
      <div className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-gray-500"}`}>
        <Layers size={13} className={isDark ? "text-zinc-500" : "text-gray-400"} />
        搜索管道 (Search Pipeline)
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>启用搜索管道</span>
          <p className={`text-[10px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>聚合多源搜索结果</p>
        </div>
        <Switch
          size="small"
          checked={sp.enabled}
          onChange={v => onUpdateSP("enabled", v)}
        />
      </div>

      <div className={`border-t pt-3 space-y-3 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <div className={`text-[11px] uppercase tracking-wider ${isDark ? "text-zinc-500" : "text-gray-400"}`}>数据源</div>

        <div className="flex items-center justify-between">
          <span className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Web Search Prime</span>
          <Switch
            size="small"
            checked={sp.sources.webSearchPrime.enabled}
            onChange={v => onUpdateSPSource("webSearchPrime", { enabled: v })}
          />
        </div>

        <div className={`rounded border p-3 space-y-2.5 ${isDark ? "border-zinc-800 bg-zinc-900/30" : "border-gray-200 bg-gray-50"}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${isDark ? "text-zinc-300" : "text-gray-700"}`}>XBrowser</span>
            <Switch
              size="small"
              checked={sp.sources.xbrowser.enabled}
              onChange={v => onUpdateSPSource("xbrowser", { enabled: v })}
            />
          </div>
          <div className="space-y-1.5">
            <label className={`text-[11px] ${isDark ? "text-zinc-500" : "text-gray-400"}`}>搜索引擎（多选）</label>
            <div className="flex flex-wrap gap-1.5">
              {XBrowserEngineOptions.map(opt => {
                const checked = (sp.sources.xbrowser.engines || []).includes(opt.value)
                return (
                  <Tag
                    key={opt.value}
                    style={{
                      background: checked ? "#1f6feb33" : (isDark ? "#27272a" : "#f4f4f5"),
                      border: checked ? "1px solid #3b82f6" : (isDark ? "1px solid #3f3f46" : "1px solid #d4d4d8"),
                      color: checked ? "#60a5fa" : (isDark ? "#a1a1aa" : "#52525b"),
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                    onClick={() => {
                      const current = sp.sources.xbrowser.engines || []
                      const next = checked
                        ? current.filter((e: XBrowserEngine) => e !== opt.value)
                        : [...current, opt.value]
                      onUpdateSPSource("xbrowser", { engines: next.length > 0 ? next : ["bing"] })
                    }}
                  >
                    {opt.label}
                  </Tag>
                )
              })}
            </div>
            <span className={`text-[10px] ${isDark ? "text-zinc-600" : "text-gray-400"}`}>已选 {(sp.sources.xbrowser.engines || []).length} 个引擎，每个引擎独立并行搜索</span>
          </div>
          <div className="space-y-1.5">
            <label className={`text-[11px] ${isDark ? "text-zinc-500" : "text-gray-400"}`}>CDP Endpoint</label>
            <Input
              size="small"
              value={sp.sources.xbrowser.cdpEndpoint}
              onChange={e => onUpdateSPSource("xbrowser", { cdpEndpoint: e.target.value })}
              placeholder="ws://localhost:9221"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className={`text-[11px] ${isDark ? "text-zinc-500" : "text-gray-400"}`}>Headless</span>
              <Switch
                size="small"
                checked={sp.sources.xbrowser.headless}
                onChange={v => onUpdateSPSource("xbrowser", { headless: v })}
              />
            </div>
            <div className="flex items-center gap-2 flex-1">
              <span className={`text-[11px] shrink-0 ${isDark ? "text-zinc-500" : "text-gray-400"}`}>Timeout</span>
              <InputNumber
                size="small"
                min={5000}
                max={120000}
                step={5000}
                value={sp.sources.xbrowser.timeout}
                onChange={v => v != null && onUpdateSPSource("xbrowser", { timeout: v })}
                className="flex-1"
                addonAfter="ms"
              />
            </div>
          </div>
        </div>

        <div className={`rounded border p-3 space-y-2.5 ${isDark ? "border-zinc-800 bg-zinc-900/30" : "border-gray-200 bg-gray-50"}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${isDark ? "text-zinc-300" : "text-gray-700"}`}>LLM 直接回答</span>
            <Switch
              size="small"
              checked={sp.sources.llmDirect.enabled}
              onChange={v => onUpdateSPSource("llmDirect", { enabled: v })}
            />
          </div>
          <div className="space-y-1.5">
            <label className={`text-[11px] ${isDark ? "text-zinc-500" : "text-gray-400"}`}>Base URL</label>
            <Input
              size="small"
              value={sp.sources.llmDirect.baseUrl}
              onChange={e => onUpdateSPSource("llmDirect", { baseUrl: e.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </div>
          <div className="space-y-1.5">
            <label className={`text-[11px] ${isDark ? "text-zinc-500" : "text-gray-400"}`}>API Key</label>
            <Input
              size="small"
              type="password"
              value={sp.sources.llmDirect.apiKey}
              onChange={e => onUpdateSPSource("llmDirect", { apiKey: e.target.value })}
              placeholder="sk-xxx"
            />
          </div>
          <div className="space-y-1.5">
            <label className={`text-[11px] ${isDark ? "text-zinc-500" : "text-gray-400"}`}>Model</label>
            <Input
              size="small"
              value={sp.sources.llmDirect.model}
              onChange={e => onUpdateSPSource("llmDirect", { model: e.target.value })}
              placeholder="gpt-4o / deepseek-chat"
            />
          </div>
        </div>

        <div className={`rounded border p-3 space-y-2.5 ${isDark ? "border-zinc-800 bg-zinc-900/30" : "border-gray-200 bg-gray-50"}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${isDark ? "text-zinc-300" : "text-gray-700"}`}>插件插槽</span>
            <Switch
              size="small"
              checked={sp.sources.plugin.enabled}
              onChange={v => onUpdateSPSource("plugin", { enabled: v })}
            />
          </div>
          <div className="space-y-1.5">
            <label className={`text-[11px] ${isDark ? "text-zinc-500" : "text-gray-400"}`}>Prompt（插槽描述）</label>
            <Input.TextArea
              rows={4}
              value={sp.sources.plugin.prompt}
              onChange={e => onUpdateSPSource("plugin", { prompt: e.target.value })}
              placeholder="粘贴插件描述或自定义搜索 prompt..."
              style={{
                background: isDark ? "#27272a" : "#f4f4f5",
                borderColor: isDark ? "#3f3f46" : "#d4d4d8",
                color: isDark ? "#d4d4d8" : "#52525b",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
          </div>
        </div>
      </div>

      <div className={`space-y-1.5 border-t pt-3 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>最大结果数</label>
        <InputNumber
          size="small"
          min={1}
          max={100}
          value={sp.maxResults}
          onChange={v => v != null && onUpdateSP("maxResults", v)}
          className="w-full"
        />
      </div>
    </section>
  )
}
