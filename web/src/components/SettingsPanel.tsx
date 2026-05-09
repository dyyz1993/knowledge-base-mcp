import { useState, useEffect, useCallback } from "react"
import { Drawer, Select, Input, InputNumber, Switch, Slider, Button, Tag, message, Divider, Tooltip } from "antd"
import { Settings, Eye, EyeOff, RefreshCw, Save, Wifi, WifiOff, Loader2, Brain, Search, FolderSearch, Globe } from "lucide-react"
import { getConfig, updateConfig, reindexEmbeddings, scanSkills, getSkillPaths, updateSkillPaths, detectBrowser, type AppConfig, type EmbeddingConfig, type SearchConfig } from "../services/api"

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

interface BrowserConfig {
  cdpEndpoint: string
  browserPath: string
  headless: boolean
  timeout: number
}

const DEFAULT_BROWSER: BrowserConfig = {
  cdpEndpoint: "",
  browserPath: "",
  headless: true,
  timeout: 15000,
}

type FullConfig = AppConfig & { browser?: BrowserConfig }

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [config, setConfig] = useState<FullConfig>({ embedding: { ...DEFAULT_EMBEDDING }, search: { ...DEFAULT_SEARCH }, browser: { ...DEFAULT_BROWSER } })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reindexing, setReindexing] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [connected, setConnected] = useState<boolean | null>(null)
  const [skillPaths, setSkillPaths] = useState<string[]>([])
  const [newPath, setNewPath] = useState("")
  const [scanning, setScanning] = useState(false)
  const [scanResult, setScanResult] = useState<{ total: number; imported: number; skipped: number; errors: string[] } | null>(null)
  const [detecting, setDetecting] = useState(false)

  const updateBrowser = <K extends keyof BrowserConfig>(key: K, value: BrowserConfig[K]) => {
    setConfig(prev => ({ ...prev, browser: { ...(prev.browser || { ...DEFAULT_BROWSER }), [key]: value } }))
  }

  const handleDetectBrowser = async () => {
    setDetecting(true)
    try {
      const res = await detectBrowser()
      if (res.path) {
        updateBrowser("browserPath", res.path)
        message.success(`Detected: ${res.path}`)
      } else {
        message.warning("No browser detected")
      }
    } catch {
      message.error("Failed to detect browser")
    } finally {
      setDetecting(false)
    }
  }

  const loadConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getConfig() as FullConfig
      setConfig({
        embedding: { ...DEFAULT_EMBEDDING, ...data.embedding },
        search: { ...DEFAULT_SEARCH, ...data.search, weights: { ...DEFAULT_SEARCH.weights, ...data.search?.weights } },
        browser: { ...DEFAULT_BROWSER, ...data.browser },
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

  useEffect(() => {
    if (open) {
      getSkillPaths().then(data => setSkillPaths(data.paths || [])).catch(() => {})
      setScanResult(null)
    }
  }, [open])

  const handleSave = async () => {
    setSaving(true)
    try {
      const updated = await updateConfig(config) as FullConfig
      setConfig({
        embedding: { ...DEFAULT_EMBEDDING, ...updated.embedding },
        search: { ...DEFAULT_SEARCH, ...updated.search, weights: { ...DEFAULT_SEARCH.weights, ...updated.search?.weights } },
        browser: { ...DEFAULT_BROWSER, ...updated.browser },
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

  const handleAddPath = () => {
    const trimmed = newPath.trim()
    if (!trimmed) return
    if (skillPaths.includes(trimmed)) {
      message.warning("Path already exists")
      return
    }
    const updated = [...skillPaths, trimmed]
    setSkillPaths(updated)
    updateSkillPaths(updated).catch(() => message.error("Failed to save paths"))
    setNewPath("")
  }

  const handleRemovePath = (path: string) => {
    const updated = skillPaths.filter(p => p !== path)
    setSkillPaths(updated)
    updateSkillPaths(updated).catch(() => message.error("Failed to save paths"))
  }

  const handleScanSkills = async () => {
    setScanning(true)
    setScanResult(null)
    try {
      const res = await scanSkills()
      setScanResult(res)
      if (res.errors.length > 0) {
        message.warning(`Scanned: ${res.imported} imported, ${res.skipped} skipped, ${res.errors.length} errors`)
      } else {
        message.success(`Scanned: ${res.imported} imported, ${res.skipped} skipped`)
      }
    } catch {
      message.error("Failed to scan skills")
    } finally {
      setScanning(false)
    }
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
        mask: { background: "rgba(0,0,0,0.6)" },
      }}
      footer={
        <div className="flex items-center gap-2" style={{ background: "#18181b", padding: "12px 16px" }}>
          <Button
            icon={<Save size={13} />}
            onClick={handleSave}
            loading={saving}
            className="flex items-center gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
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
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <FolderSearch size={13} className="text-zinc-500" />
              Skill 路径管理
            </div>

            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Scanned Paths</label>
              <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                {skillPaths.length === 0 && (
                  <span className="text-xs text-zinc-600">No paths configured</span>
                )}
                {skillPaths.map(p => (
                  <Tag
                    key={p}
                    closable
                    onClose={() => handleRemovePath(p)}
                    style={{ background: "#27272a", border: "1px solid #3f3f46", color: "#a1a1aa" }}
                  >
                    {p}
                  </Tag>
                ))}
              </div>
            </div>

            <div className="flex gap-1.5">
              <Input
                size="small"
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                placeholder="~/path/to/skills"
                className="flex-1"
                onPressEnter={handleAddPath}
              />
              <Button size="small" onClick={handleAddPath}>
                Add
              </Button>
            </div>

            <Button
              icon={<FolderSearch size={13} />}
              onClick={handleScanSkills}
              loading={scanning}
              block
              className="flex items-center justify-center gap-1.5 bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
            >
              Scan Skills
            </Button>

            {scanResult && (
              <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Total scanned:</span>
                  <span className="text-zinc-200">{scanResult.total}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-green-400">Imported:</span>
                  <span className="text-green-300">{scanResult.imported}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-yellow-400">Skipped:</span>
                  <span className="text-yellow-300">{scanResult.skipped}</span>
                </div>
                {scanResult.errors.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-zinc-800">
                    <span className="text-red-400">Errors:</span>
                    <ul className="mt-1 space-y-0.5 text-red-300/80 list-disc list-inside">
                      {scanResult.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <Globe size={13} className="text-zinc-500" />
              Browser 配置
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">CDP 端点</label>
              <Input
                size="small"
                value={config.browser?.cdpEndpoint || ""}
                onChange={e => updateBrowser("cdpEndpoint", e.target.value)}
                placeholder="ws://host:port/... 或留空使用本地浏览器"
              />
              <span className="text-[11px] text-zinc-600">配置后使用远程浏览器，无需本地安装</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">浏览器路径</label>
              <div className="flex gap-1.5">
                <Input
                  size="small"
                  value={config.browser?.browserPath || ""}
                  onChange={e => updateBrowser("browserPath", e.target.value)}
                  placeholder="留空自动检测本地 Chrome/Chromium"
                  className="flex-1"
                />
                <Button
                  size="small"
                  onClick={handleDetectBrowser}
                  loading={detecting}
                >
                  Detect
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Headless 模式</span>
                <Switch
                  size="small"
                  checked={config.browser?.headless ?? true}
                  onChange={v => updateBrowser("headless", v)}
                />
              </div>
              <div className="flex items-center gap-2 flex-1">
                <span className="text-xs text-zinc-400 shrink-0">超时时间</span>
                <InputNumber
                  size="small"
                  min={1000}
                  max={120000}
                  step={1000}
                  value={config.browser?.timeout ?? 15000}
                  onChange={v => v != null && updateBrowser("timeout", v)}
                  className="flex-1"
                  addonAfter="ms"
                />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <Brain size={13} className="text-zinc-500" />
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
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
              <Search size={13} className="text-zinc-500" />
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
