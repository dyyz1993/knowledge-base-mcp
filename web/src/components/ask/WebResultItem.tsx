import { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink, Globe, Save, Loader2 } from "lucide-react"
import { useAskStore } from "../../stores/ask"
import { webRead } from "../../services/api"
import type { WebSearchItem } from "../../services/api"
import { useTheme } from "../../theme"

function inferSourceType(url: string): { label: string; color: string } {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes("github.com") || host.includes("gitlab.com")) return { label: "repository", color: "bg-violet-900/50 text-violet-400" }
    if (host.includes("stackoverflow.com") || host.includes("developer.mozilla.org") || host.includes("docs.")) return { label: "documentation", color: "bg-blue-900/50 text-blue-400" }
    if (host.includes("medium.com") || host.includes("dev.to") || host.includes("blog.") || host.includes("substack.com")) return { label: "blog", color: "bg-orange-900/50 text-orange-400" }
    if (host.includes("npmjs.com") || host.includes("pypi.org") || host.includes("crates.io") || host.includes("hub.docker.com")) return { label: "platform", color: "bg-amber-900/50 text-amber-400" }
    if (host.endsWith(".org") || host.endsWith(".edu") || host.endsWith(".gov")) return { label: "official", color: "bg-emerald-900/50 text-emerald-400" }
  } catch { /* ignore */ }
  return { label: "web", color: "bg-zinc-800 text-zinc-400" }
}

function inferQuality(content: string): { level: string; color: string } {
  const len = content.length
  if (len >= 300) return { level: "high", color: "text-emerald-400" }
  if (len >= 100) return { level: "medium", color: "text-amber-400" }
  return { level: "low", color: "text-zinc-500" }
}

export function WebResultItem({ item, query }: { item: WebSearchItem; query: string }) {
  const [reading, setReading] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const [showIngest, setShowIngest] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const handleRead = async () => {
    if (reading) return
    setReading(true)
    try {
      const result = await webRead(item.link)
      if (result.success && result.content) {
        setDetail(result.content)
        setShowIngest(true)
      } else {
        setDetail("抓取失败")
      }
    } catch {
      setDetail("抓取失败")
    }
    setReading(false)
  }

  const handleSave = () => {
    if (detail && item.title) {
      useAskStore.getState().ingest(item.link, item.title, detail, ["reference", "web-ingested"])
      setShowIngest(false)
      setDetail(null)
    }
  }

  const sourceType = inferSourceType(item.link)
  const quality = inferQuality(item.content)
  const isDark_ = isDark

  return (
    <div className={`rounded-lg border overflow-hidden ${isDark_ ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-gray-50"}`}>
      <div className="px-2.5 py-1.5">
        <div className="flex items-start gap-1.5">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <a
                href={item.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-blue-400 hover:text-blue-300 truncate flex-1"
              >
                {item.title}
              </a>
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium ${sourceType.color}`}>
                {sourceType.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[9px] truncate max-w-[180px] ${isDark_ ? "text-zinc-600" : "text-gray-400"}`}>
                {item.link}
              </span>
              <span className={`text-[9px] font-medium ${quality.color}`}>
                {quality.level}
              </span>
            </div>
            <p className={`text-[10px] mt-0.5 ${isDark_ ? "text-zinc-500" : "text-gray-500"} ${expanded ? "" : "line-clamp-2"}`}>{item.content}</p>
            {item.content && item.content.length > 80 && (
              <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className={`flex items-center gap-1 mt-0.5 text-[10px] ${isDark_ ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                {expanded ? "收起" : "展开"}
              </button>
            )}
          </div>
          <ExternalLink size={10} className={`${isDark_ ? "text-zinc-600" : "text-gray-400"} shrink-0 mt-0.5`} />
        </div>
      </div>
      <div className={`px-2.5 py-1.5 border-t flex items-center gap-2 ${isDark_ ? "border-zinc-800" : "border-gray-200"}`}>
        <button
          onClick={handleRead}
          disabled={reading}
          aria-label={reading ? "正在抓取" : "读取详情"}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-50 transition-colors ${isDark_ ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
        >
          {reading ? <Loader2 size={10} className="animate-spin" /> : <Globe size={10} />}
          {reading ? "抓取中..." : "读取详情"}
        </button>
      </div>
      {detail && (
        <div className={`px-2.5 py-2 border-t ${isDark_ ? "border-zinc-800" : "border-gray-200"}`}>
          <div className={`text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto ${isDark_ ? "text-zinc-400" : "text-gray-600"}`}>{detail.slice(0, 3000)}</div>
          {showIngest && (
            <button
              onClick={handleSave}
              aria-label="存入知识库"
              className="flex items-center gap-1 px-2 py-1 mt-2 rounded text-[10px] font-medium bg-teal-700 text-white hover:bg-teal-600 transition-colors"
            >
              <Save size={10} />
              存入知识库
            </button>
          )}
        </div>
      )}
    </div>
  )
}
