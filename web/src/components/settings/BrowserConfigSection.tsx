import { Input, InputNumber, Switch, Button } from "antd"
import type { BrowserConfig } from "./constants"

interface BrowserConfigSectionProps {
  browser: BrowserConfig
  detecting: boolean
  onUpdate: <K extends keyof BrowserConfig>(key: K, value: BrowserConfig[K]) => void
  onDetect: () => void
}

export function BrowserConfigSection({ browser, detecting, onUpdate, onDetect }: BrowserConfigSectionProps) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-500"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
        Browser 配置
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-zinc-400">CDP 端点</label>
        <Input
          size="small"
          value={browser.cdpEndpoint}
          onChange={e => onUpdate("cdpEndpoint", e.target.value)}
          placeholder="ws://host:port/... 或留空使用本地浏览器"
        />
        <span className="text-[11px] text-zinc-600">配置后使用远程浏览器，无需本地安装</span>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-zinc-400">浏览器路径</label>
        <div className="flex gap-1.5">
          <Input
            size="small"
            value={browser.browserPath}
            onChange={e => onUpdate("browserPath", e.target.value)}
            placeholder="留空自动检测本地 Chrome/Chromium"
            className="flex-1"
          />
          <Button
            size="small"
            onClick={onDetect}
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
            checked={browser.headless}
            onChange={v => onUpdate("headless", v)}
          />
        </div>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-xs text-zinc-400 shrink-0">超时时间</span>
          <InputNumber
            size="small"
            min={1000}
            max={120000}
            step={1000}
            value={browser.timeout}
            onChange={v => v != null && onUpdate("timeout", v)}
            className="flex-1"
            addonAfter="ms"
          />
        </div>
      </div>
    </section>
  )
}
