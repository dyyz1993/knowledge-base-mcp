import { useState, useEffect, useCallback } from "react"
import { Drawer, Select, Input, InputNumber, Switch, Slider, Button, message, Divider, Tooltip } from "antd"
import { Settings, Eye, EyeOff, RefreshCw, Save, Wifi, WifiOff, Loader2, Brain, Search } from "lucide-react"
import { getConfig, updateConfig, reindexEmbeddings, type AppConfig, type EmbeddingConfig, type SearchConfig } from "../services/api"

const PROVIDERS = [
  { value: "siliconflow", label: "SiliconFlow" },
  { value: "local", label: "Local" },
  { value: "openai", label: "OpenAI" },
  { value: "custom", label: "Custom" },
] as const

const PRESET_MODELS: Record<string, { value: string; label: string }[]> = {
  siliconflow: [
    { value: "Pro/BAAI/bge-m3", label: "Pro/BAAI/bge-m3" },
    { value: "Qwen/Qwen3-VL-Embedding-8B", label: "Qwen/Qwen3-VL-Embedding-8B" },
    { value: "BAAI/bge-large-zh-v1.5", label: "BAAI/bge-large-zh-v1.5" },
  ],
  openai: [
    { value: "text-embedding-3-small", label: "text-embedding-3-small" },
    { value: "text-embedding-3-large", label: "text-embedding-3-large" },
    { value: "text-embedding-ada-002", label: "text-embedding-ada-002" },
  ],
  local: [],
  custom: [],
}

const SEARCH_MODES = [
  { value: "combined", label: "Combined (Hybrid)" },
  { value: "tfidf", label: "TF-IDF Only" },
  { value: "semantic", label: "Semantic Only" },
] as const

const DEFAULT_EMBEDDING: EmbeddingConfig = {
  provider: "siliconflow",
  baseUrl: "https://api.siliconflow.cn/v1",
  apiKey: "",
  model: "Pro/BAAI/bge-m3",
  dimensions: 1024,
  enabled: true,
}

const DEFAULT_SEARCH: SearchConfig = {
  mode: "combined",
  minScore: 5.0,
  weights: { token: 0.2, tfidf: 0.3, semantic: 0.5 },
}

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [config, setConfig] = useState<AppConfig>({ embedding: { ...DEFAULT_EMBEDDING }, search: { ...DEFAULT_SEARCH } })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getConfig()
      setConfig({
        embedding: { ...DEFAULT_EMBEDDING, ...data.embedding },
        search: { ...DEFAULT_SEARCH, ...data.search, weights: { ...DEFAULT_SEARCH.weights, ...data.search?.weights } },
      })
    } catch {
      message.error("Failed to load config")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) loadConfig()
  }, [open, loadConfig])

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await updateConfig(config)
      setConfig({
        embedding: { ...DEFAULT_EMBEDDING, ...updated.embedding },
        search: { ...DEFAULT_SEARCH, ...updated.search, weights: { ...DEFAULT_SEARCH.weights, ...updated.search?.weights } },
      })
      message.success("Configuration saved")
    } catch {
      message.error("Failed to save config")
    } finally {
      setSaving(false)
    }
  }

  const handleReindex = async () => {
    setReindexing(true)
    try {
      const res = await reindexEmbeddings()
      if (res.success) {
        message.success("Reindex completed")
      } else {
        message.error(res.message || "Reindex failed")
      }
    } catch {
      message.error("Failed to reindex")
    } finally {
      setReindexing(false)
    }
  }

  const handleTestConnection = async () => {
    setConnected(null)
    try {
      const res = await fetch(`${""}/api/embedding/test`, { method: "POST" })
      const data = await res.json()
      setConnected(data.success !== false)
      message.success(data.success !== false ? "Connection OK" : "Connection failed")
    } catch {
      setConnected(false)
      message.error("Connection failed")
    }
  }

  const updateEmbedding = <K extends keyof EmbeddingConfig>(key: K, value: EmbeddingConfig[K]) => {
    setConfig(prev => ({ ...prev, embedding: { ...prev.embedding, [key]: value } }))
  }

  const updateSearch = <K extends keyof SearchConfig>(key: K, value: SearchConfig[K]) => {
    setConfig(prev => ({ ...prev, search: { ...prev.search, [key]: value } }))
  }

  const updateWeight = (key: keyof SearchConfig["weights"], value: number) => {
    setConfig(prev => ({
      ...prev,
      search: { ...prev.search, weights: { ...prev.search.weights, [key]: value } },
    }))
  }

  const presetModels = PRESET_MODELS[config.embedding.provider] || []
  const normalizedWeights = {
    token: config.search.weights.token * 100,
    tfidf: config.search.weights.tfidf * 100,
    semantic: config.search.weights.semantic * 100,
  }

  return (
    <Drawer
      title={
        <div className="flex items-center gap-2 text-sm">
          <Settings size={15} />
          <span>Settings</span>
        </div>
      }
      placement="right"
      width={420}
      open={open}
      onClose={onClose}
      styles={{
        header: { background: "#18181b", borderBottom: "1px solid #27272a" },
        body: { background: "#09090b", padding: "16px" },
      }}
      footer={
        <div className="flex items-center gap-2" style={{ background: "#18181b", padding: "12px 16px" }}>
          <Button
            type="primary"
            icon={<Save size={13} />}
            onClick={handleSave}
            loading={saving}
            className="flex items-center gap-1.5"
          >
            Save
          </Button>
          <Button
            icon={<RefreshCw size={13} className={reindexing ? "animate-spin" : ""} />}
            onClick={handleReindex}
            loading={reindexing}
            className="flex items-center gap-1.5"
          >
            Reindex
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {connected !== null && (
              <span className="flex items-center gap-1 text-xs text-zinc-400">
                {connected ? <Wifi size={12} className="text-green-400" /> : <WifiOff size={12} className="text-red-400" />}
                {connected ? "Connected" : "Disconnected"}
              </span>
            )}
            <Button size="small" onClick={handleTestConnection} className="flex items-center gap-1.5">
              Test
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-zinc-500">
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading...
        </div>
      ) : (
        <div className="space-y-5">
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-300 uppercase tracking-wider">
              <Brain size={13} className="text-blue-400" />
              Embedding
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">Enabled</span>
              <Switch
                size="small"
                checked={config.embedding.enabled}
                onChange={v => updateEmbedding("enabled", v)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Provider</label>
              <Select
                value={config.embedding.provider}
                options={[...PROVIDERS]}
                onChange={v => updateEmbedding("provider", v)}
                className="w-full"
                size="small"
              />
            </div>

            {config.embedding.provider !== "local" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">Base URL</label>
                  <Input
                    size="small"
                    value={config.embedding.baseUrl}
                    onChange={e => updateEmbedding("baseUrl", e.target.value)}
                    placeholder="https://api.siliconflow.cn/v1"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-zinc-400">API Key</label>
                  <div className="flex gap-1.5">
                    <Input
                      size="small"
                      type={showKey ? "text" : "password"}
                      value={config.embedding.apiKey}
                      onChange={e => updateEmbedding("apiKey", e.target.value)}
                      placeholder="sk-xxx"
                      className="flex-1"
                    />
                    <Tooltip title={showKey ? "Hide" : "Show"}>
                      <Button
                        size="small"
                        type="text"
                        icon={showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                        onClick={() => setShowKey(!showKey)}
                      />
                    </Tooltip>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Model</label>
              {presetModels.length > 0 ? (
                <Select
                  value={config.embedding.model}
                  options={presetModels}
                  onChange={v => updateEmbedding("model", v)}
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
                        value={config.embedding.model}
                        onChange={e => updateEmbedding("model", e.target.value)}
                        className="mx-1"
                        style={{ width: "calc(100% - 16px)" }}
                      />
                    </div>
                  )}
                />
              ) : (
                <Input
                  size="small"
                  value={config.embedding.model}
                  onChange={e => updateEmbedding("model", e.target.value)}
                  placeholder="Model name"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Dimensions</label>
              <InputNumber
                size="small"
                min={128}
                max={8192}
                step={128}
                value={config.embedding.dimensions}
                onChange={v => v != null && updateEmbedding("dimensions", v)}
                className="w-full"
              />
            </div>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-300 uppercase tracking-wider">
              <Search size={13} className="text-green-400" />
              Search
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Search Mode</label>
              <Select
                value={config.search.mode}
                options={[...SEARCH_MODES]}
                onChange={v => updateSearch("mode", v)}
                className="w-full"
                size="small"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Min Score Threshold</label>
              <InputNumber
                size="small"
                min={0}
                max={100}
                step={0.5}
                value={config.search.minScore}
                onChange={v => v != null && updateSearch("minScore", v)}
                className="w-full"
              />
            </div>

            {config.search.mode === "combined" && (
              <div className="space-y-3">
                <label className="text-xs text-zinc-400">Weights</label>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-zinc-500 w-14 shrink-0">Token</span>
                    <Slider
                      min={0}
                      max={100}
                      value={normalizedWeights.token}
                      onChange={v => updateWeight("token", v / 100)}
                      className="flex-1"
                      styles={{ track: { background: "#3b82f6" } }}
                    />
                    <span className="text-[11px] text-zinc-500 w-8 text-right">{normalizedWeights.token}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-zinc-500 w-14 shrink-0">TF-IDF</span>
                    <Slider
                      min={0}
                      max={100}
                      value={normalizedWeights.tfidf}
                      onChange={v => updateWeight("tfidf", v / 100)}
                      className="flex-1"
                      styles={{ track: { background: "#8b5cf6" } }}
                    />
                    <span className="text-[11px] text-zinc-500 w-8 text-right">{normalizedWeights.tfidf}%</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-zinc-500 w-14 shrink-0">Semantic</span>
                    <Slider
                      min={0}
                      max={100}
                      value={normalizedWeights.semantic}
                      onChange={v => updateWeight("semantic", v / 100)}
                      className="flex-1"
                      styles={{ track: { background: "#10b981" } }}
                    />
                    <span className="text-[11px] text-zinc-500 w-8 text-right">{normalizedWeights.semantic}%</span>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  )
}
