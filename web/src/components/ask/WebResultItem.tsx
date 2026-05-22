import { useState } from "react"
import { ChevronDown, ChevronUp, ExternalLink, Globe, Save, Loader2 } from "lucide-react"
import { useAskStore } from "../../stores/ask"
import { webRead } from "../../services/api"
import type { WebSearchItem } from "../../services/api"

export function WebResultItem({ item, query }: { item: WebSearchItem; query: string }) {
  const [reading, setReading] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const [showIngest, setShowIngest] = useState(false)
  const [expanded, setExpanded] = useState(false)

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
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
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
          <ExternalLink size={10} className="text-zinc-600 shrink-0 mt-0.5" />
        </div>
        <p className={`text-[10px] text-zinc-500 mt-0.5 ${expanded ? "" : "line-clamp-2"}`}>{item.content}</p>
        {item.content && item.content.length > 80 && (
          <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-500 hover:text-zinc-300">
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {expanded ? "收起" : "展开"}
          </button>
        )}
      </div>
      <div className="px-2.5 py-1.5 border-t border-zinc-800 flex items-center gap-2">
        <button
          onClick={handleRead}
          disabled={reading}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {reading ? <Loader2 size={10} className="animate-spin" /> : <Globe size={10} />}
          {reading ? "抓取中..." : "读取详情"}
        </button>
      </div>
      {detail && (
        <div className="px-2.5 py-2 border-t border-zinc-800">
          <div className="text-[10px] text-zinc-400 whitespace-pre-wrap max-h-40 overflow-y-auto">{detail.slice(0, 3000)}</div>
          {showIngest && (
            <button
              onClick={handleSave}
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
