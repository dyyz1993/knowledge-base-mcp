import { useState, useEffect, useCallback } from "react"
import { Drawer, Button, message, ConfigProvider, theme } from "antd"
import { Settings, RefreshCw, Save, Wifi, WifiOff, Loader2 } from "lucide-react"
import { getConfig, updateConfig, reindexEmbeddings, scanSkills, getSkillPaths, updateSkillPaths, detectBrowser, type EmbeddingConfig, type SearchConfig, type SearchPipelineConfig } from "../services/api"
import { DEFAULT_EMBEDDING, DEFAULT_SEARCH, DEFAULT_BROWSER, DEFAULT_SEARCH_PIPELINE, type BrowserConfig, type FullConfig } from "./settings/constants"
import { SkillPathsSection } from "./settings/SkillPathsSection"
import { BrowserConfigSection } from "./settings/BrowserConfigSection"
import { WebSearchSection } from "./settings/WebSearchSection"
import { EmbeddingSection } from "./settings/EmbeddingSection"
import { SearchSection } from "./settings/SearchSection"
import { SearchPipelineSection } from "./settings/SearchPipelineSection"

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [config, setConfig] = useState<FullConfig>({
    embedding: { ...DEFAULT_EMBEDDING },
    search: { ...DEFAULT_SEARCH },
    browser: { ...DEFAULT_BROWSER },
    searchPipeline: {
      ...DEFAULT_SEARCH_PIPELINE,
      sources: {
        webSearchPrime: { enabled: true },
        xbrowser: { ...DEFAULT_SEARCH_PIPELINE.sources.xbrowser },
        llmDirect: { ...DEFAULT_SEARCH_PIPELINE.sources.llmDirect },
        plugin: { ...DEFAULT_SEARCH_PIPELINE.sources.plugin },
      },
    },
  })
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
        searchPipeline: {
          ...DEFAULT_SEARCH_PIPELINE,
          ...data.searchPipeline,
          sources: {
            ...DEFAULT_SEARCH_PIPELINE.sources,
            ...data.searchPipeline?.sources,
            webSearchPrime: { ...DEFAULT_SEARCH_PIPELINE.sources.webSearchPrime, ...data.searchPipeline?.sources?.webSearchPrime },
            xbrowser: { ...DEFAULT_SEARCH_PIPELINE.sources.xbrowser, ...data.searchPipeline?.sources?.xbrowser },
            llmDirect: { ...DEFAULT_SEARCH_PIPELINE.sources.llmDirect, ...data.searchPipeline?.sources?.llmDirect },
            plugin: { ...DEFAULT_SEARCH_PIPELINE.sources.plugin, ...data.searchPipeline?.sources?.plugin },
          },
        },
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
        webSearch: updated.webSearch || config.webSearch,
        searchPipeline: {
          ...DEFAULT_SEARCH_PIPELINE,
          ...updated.searchPipeline,
          sources: {
            ...DEFAULT_SEARCH_PIPELINE.sources,
            ...updated.searchPipeline?.sources,
            webSearchPrime: { ...DEFAULT_SEARCH_PIPELINE.sources.webSearchPrime, ...updated.searchPipeline?.sources?.webSearchPrime },
            xbrowser: { ...DEFAULT_SEARCH_PIPELINE.sources.xbrowser, ...updated.searchPipeline?.sources?.xbrowser },
            llmDirect: { ...DEFAULT_SEARCH_PIPELINE.sources.llmDirect, ...updated.searchPipeline?.sources?.llmDirect },
            plugin: { ...DEFAULT_SEARCH_PIPELINE.sources.plugin, ...updated.searchPipeline?.sources?.plugin },
          },
        },
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
      const res = await fetch("/api/embedding/test", { method: "POST" })
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

  const sp = config.searchPipeline || DEFAULT_SEARCH_PIPELINE

  const updateSP = <K extends keyof SearchPipelineConfig>(key: K, value: SearchPipelineConfig[K]) => {
    setConfig(prev => ({ ...prev, searchPipeline: { ...(prev.searchPipeline || DEFAULT_SEARCH_PIPELINE), [key]: value } }))
  }

  const updateSPSource = <K extends keyof SearchPipelineConfig["sources"]>(key: K, value: Partial<SearchPipelineConfig["sources"][K]>) => {
    setConfig(prev => {
      const prevSP = prev.searchPipeline || DEFAULT_SEARCH_PIPELINE
      return {
        ...prev,
        searchPipeline: {
          ...prevSP,
          sources: {
            ...prevSP.sources,
            [key]: { ...(prevSP.sources[key] as Record<string, unknown>), ...value },
          },
        },
      }
    })
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
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorBgContainer: "#27272a",
          colorBgElevated: "#18181b",
          colorBorder: "#3f3f46",
          colorText: "#d4d4d8",
          colorTextPlaceholder: "#71717a",
          colorPrimary: "#3b82f6",
          borderRadius: 6,
        },
        components: {
          Input: { colorBgContainer: "#27272a" },
          Select: { colorBgContainer: "#27272a", colorBgElevated: "#18181b" },
          InputNumber: { colorBgContainer: "#27272a" },
          Switch: { colorPrimary: "#3b82f6", colorPrimaryHover: "#60a5fa" },
          Button: { colorBgContainer: "#27272a", colorBorder: "#3f3f46" },
          Tag: { colorBgContainer: "#27272a" },
          Slider: { trackBg: "#3f3f46" },
        },
      }}
    >
    <Drawer
      title={
        <div className="flex items-center gap-2 text-sm">
          <Settings size={15} />
          <span>Settings</span>
        </div>
      }
      placement="right"
      width={typeof window !== 'undefined' && window.innerWidth < 640 ? window.innerWidth : 420}
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
          <SkillPathsSection
            skillPaths={skillPaths}
            newPath={newPath}
            scanning={scanning}
            scanResult={scanResult}
            onNewPathChange={setNewPath}
            onAddPath={handleAddPath}
            onRemovePath={handleRemovePath}
            onScanSkills={handleScanSkills}
          />

          <BrowserConfigSection
            browser={config.browser || DEFAULT_BROWSER}
            detecting={detecting}
            onUpdate={updateBrowser}
            onDetect={handleDetectBrowser}
          />

          <WebSearchSection
            enabled={config.webSearch?.enabled ?? true}
            apiKey={config.webSearch?.apiKey || ""}
            showKey={showKey}
            onEnabledChange={v => setConfig(prev => ({ ...prev, webSearch: { ...(prev.webSearch || { apiKey: "", enabled: true }), enabled: v } }))}
            onApiKeyChange={v => setConfig(prev => ({ ...prev, webSearch: { ...(prev.webSearch || { enabled: true }), apiKey: v } }))}
          />

          <EmbeddingSection
            embedding={config.embedding}
            showKey={showKey}
            onUpdate={updateEmbedding}
            onToggleShowKey={() => setShowKey(!showKey)}
          />

          <SearchSection
            search={config.search}
            onUpdateSearch={updateSearch}
            onUpdateWeight={updateWeight}
          />

          <SearchPipelineSection
            sp={sp}
            onUpdateSP={updateSP}
            onUpdateSPSource={updateSPSource}
          />
        </div>
      )}
    </Drawer>
    </ConfigProvider>
  )
}
