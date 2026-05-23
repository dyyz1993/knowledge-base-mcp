import { ConfigProvider, theme, Drawer, Button } from "antd"
import { Settings, RefreshCw, Save, Wifi, WifiOff, Loader2 } from "lucide-react"
import { SkillPathsSection } from "./settings/SkillPathsSection"
import { BrowserConfigSection } from "./settings/BrowserConfigSection"
import { WebSearchSection } from "./settings/WebSearchSection"
import { EmbeddingSection } from "./settings/EmbeddingSection"
import { SearchSection } from "./settings/SearchSection"
import { SearchPipelineSection } from "./settings/SearchPipelineSection"
import { DEFAULT_BROWSER, DEFAULT_SEARCH_PIPELINE } from "./settings/constants"
import { useSettings } from "./settings/useSettings"

export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    config, loading, saving, reindexing, showKey, connected,
    skillPaths, newPath, scanning, scanResult, detecting, sp,
    handleSave, handleReindex, handleTestConnection,
    updateEmbedding, updateSearch, updateWeight, updateBrowser,
    updateSP, updateSPSource, handleDetectBrowser,
    handleAddPath, handleRemovePath, handleScanSkills,
    setShowKey, setNewPath, setConfig,
  } = useSettings(open)

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
