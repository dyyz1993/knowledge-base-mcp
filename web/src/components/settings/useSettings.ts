import { useState, useEffect, useCallback } from "react"
import { message } from "antd"
import { getConfig, updateConfig, reindexEmbeddings, getSkillPaths, updateSkillPaths, scanSkills, detectBrowser, type EmbeddingConfig, type SearchConfig, type SearchPipelineConfig } from "../../services/api"
import { DEFAULT_EMBEDDING, DEFAULT_SEARCH, DEFAULT_BROWSER, DEFAULT_SEARCH_PIPELINE, type BrowserConfig, type FullConfig } from "./constants"

export function useSettings(open: boolean) {
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
      ;(async () => {
        try {
          const data = await getSkillPaths()
          setSkillPaths(data.paths || [])
        } catch (e) { if (import.meta.env.DEV) console.warn('[SettingsPanel] getSkillPaths failed:', e) }
      })()
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

  const updateBrowser = <K extends keyof BrowserConfig>(key: K, value: BrowserConfig[K]) => {
    setConfig(prev => ({ ...prev, browser: { ...(prev.browser || { ...DEFAULT_BROWSER }), [key]: value } }))
  }

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

  return {
    config,
    loading,
    saving,
    reindexing,
    showKey,
    connected,
    skillPaths,
    newPath,
    scanning,
    scanResult,
    detecting,
    sp: config.searchPipeline || DEFAULT_SEARCH_PIPELINE,
    handleSave,
    handleReindex,
    handleTestConnection,
    updateEmbedding,
    updateSearch,
    updateWeight,
    updateBrowser,
    updateSP,
    updateSPSource,
    handleDetectBrowser,
    handleAddPath,
    handleRemovePath,
    handleScanSkills,
    setShowKey,
    setNewPath,
    setConfig,
  }
}
