import { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink, Globe, Save, Loader2 } from "lucide-react"
import { useAskStore } from "../../stores/ask"
import { webRead } from "../../services/api"
import type { WebSearchItem } from "../../services/api"
import { useTheme } from "../../theme"

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

  return (
    <div className={`rounded-lg border overflow-hidden ${isDark ? "border-zinc-800 bg-zinc-950" : "border-gray-200 bg-gray-50"}`}>
      <div className="px-2.5 py-1.5">
        <div className="flex items-start gap-1.5">
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-blue-400 hover:text-blue-300 truncate flex-1"
          >
            {item.title}
          </a>
          <ExternalLink size={10} className={`${isDark ? "text-zinc-600" : "text-gray-400"} shrink-0 mt-0.5`} />
        </div>
        <p className={`text-[10px] mt-0.5 ${isDark ? "text-zinc-500" : "text-gray-500"} ${expanded ? "" : "line-clamp-2"}`}>{item.content}</p>
        {item.content && item.content.length > 80 && (
          <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded} className={`flex items-center gap-1 mt-0.5 text-[10px] ${isDark ? "text-zinc-500 hover:text-zinc-300" : "text-gray-500 hover:text-gray-700"}`}>
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {expanded ? "收起" : "展开"}
          </button>
        )}
      </div>
      <div className={`px-2.5 py-1.5 border-t flex items-center gap-2 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
        <button
          onClick={handleRead}
          disabled={reading}
          aria-label={reading ? "正在抓取" : "读取详情"}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium disabled:opacity-50 transition-colors ${isDark ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
        >
          {reading ? <Loader2 size={10} className="animate-spin" /> : <Globe size={10} />}
          {reading ? "抓取中..." : "读取详情"}
        </button>
      </div>
      {detail && (
        <div className={`px-2.5 py-2 border-t ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
          <div className={`text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto ${isDark ? "text-zinc-400" : "text-gray-600"}`}>{detail.slice(0, 3000)}</div>
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
