import { Select, Input, InputNumber, Switch, Button, Divider, Tooltip } from "antd"
import { Eye, EyeOff, Brain } from "lucide-react"
import { PROVIDERS, PRESET_MODELS } from "./constants"
import type { EmbeddingConfig } from "../../services/api"
import { useTheme } from "../../theme"

interface EmbeddingSectionProps {
  embedding: EmbeddingConfig
  showKey: boolean
  onUpdate: <K extends keyof EmbeddingConfig>(key: K, value: EmbeddingConfig[K]) => void
  onToggleShowKey: () => void
}

export function EmbeddingSection({ embedding, showKey, onUpdate, onToggleShowKey }: EmbeddingSectionProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  const presetModels = PRESET_MODELS[embedding.provider] || []

  return (
    <section className={`rounded-lg border p-4 space-y-4 ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-white"}`}>
      <div className={`flex items-center gap-2 text-xs font-medium uppercase tracking-wider ${isDark ? "text-zinc-400" : "text-gray-500"}`}>
        <Brain size={13} className={isDark ? "text-zinc-500" : "text-gray-400"} />
        Embedding
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Enabled</span>
        <Switch
          size="small"
          checked={embedding.enabled}
          onChange={v => onUpdate("enabled", v)}
        />
      </div>

      <div className="space-y-1.5">
        <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Provider</label>
        <Select
          value={embedding.provider}
          options={[...PROVIDERS]}
          onChange={v => onUpdate("provider", v)}
          className="w-full"
          size="small"
        />
      </div>

      {embedding.provider !== "local" && (
        <>
          <div className="space-y-1.5">
            <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Base URL</label>
            <Input
              size="small"
              value={embedding.baseUrl}
              onChange={e => onUpdate("baseUrl", e.target.value)}
              placeholder="https://api.siliconflow.cn/v1"
            />
          </div>

          <div className="space-y-1.5">
            <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>API Key</label>
            <div className="flex gap-1.5">
              <Input
                size="small"
                type={showKey ? "text" : "password"}
                value={embedding.apiKey}
                onChange={e => onUpdate("apiKey", e.target.value)}
                placeholder="sk-xxx"
                className="flex-1"
              />
              <Tooltip title={showKey ? "Hide" : "Show"}>
                <Button
                  size="small"
                  type="text"
                  icon={showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  onClick={onToggleShowKey}
                />
              </Tooltip>
            </div>
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Model</label>
        {presetModels.length > 0 ? (
          <Select
            value={embedding.model}
            options={presetModels}
            onChange={v => onUpdate("model", v)}
            className="w-full"
            size="small"
            showSearch
            allowClear={false}
            dropdownRender={menu => (
              <div>
                {menu}
                <Divider style={{ margin: "4px 0" }} />
                <Input
                  size="small"
                  placeholder="Custom model name..."
                  value={embedding.model}
                  onChange={e => onUpdate("model", e.target.value)}
                  className="mx-1"
                  style={{ width: "calc(100% - 16px)" }}
                />
              </div>
            )}
          />
        ) : (
          <Input
            size="small"
            value={embedding.model}
            onChange={e => onUpdate("model", e.target.value)}
            placeholder="Model name"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <label className={`text-xs ${isDark ? "text-zinc-400" : "text-gray-500"}`}>Dimensions</label>
        <InputNumber
          size="small"
          min={128}
          max={8192}
          step={128}
          value={embedding.dimensions}
          onChange={v => v != null && onUpdate("dimensions", v)}
          className="w-full"
        />
      </div>
    </section>
  )
}
