import type { ReactNode } from "react"
import CopyButton from "../CopyButton"
import { MarkdownRenderer } from "../MarkdownRenderer"
import { useTheme } from "../../theme"

interface ThinkingMessageProps {
  content: string
  streaming?: boolean
}

export function ThinkingMessage({ content, streaming }: ThinkingMessageProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  return (
    <div role="status" aria-live="polite" className={`mx-auto max-w-[80%] md:max-w-[80%] rounded-lg border px-3 py-2 text-xs italic ${isDark ? "border-zinc-800 bg-zinc-900/30 text-zinc-500" : "border-gray-200 bg-gray-50 text-gray-500"}`}>
      <span className={`font-medium ${isDark ? "text-zinc-400" : "text-gray-600"}`}>{streaming ? "Thinking..." : "Thinking"}</span>
      <p className="mt-1 whitespace-pre-wrap">{content}</p>
    </div>
  )
}

interface AssistantMessageProps {
  content: string
  messageKey: string
}

export function AssistantMessage({ content, messageKey }: AssistantMessageProps) {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  return (
    <div className="flex justify-start" role="article" aria-label="助手消息">
      <div className={`max-w-[85%] md:max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${isDark ? "bg-zinc-800 text-zinc-200" : "bg-gray-100 text-gray-800"}`}>
        <div className="group relative markdown-body">
          <MarkdownRenderer content={content} />
          <div className="mt-1.5 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ marginTop: "4px" }}>
            <CopyButton text={content} className="-mb-1" />
            <StarButton messageId={messageKey} content={content} />
          </div>
        </div>
      </div>
    </div>
  )
}

interface UserMessageProps {
  content: string
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="flex justify-end" role="article" aria-label="用户消息">
      <div className="max-w-[85%] md:max-w-[80%] rounded-2xl bg-blue-600 text-white px-4 py-2.5 text-sm leading-relaxed">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  )
}

export function StreamingIndicator() {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  return (
    <span className="inline-flex gap-1 ml-1" role="status" aria-label="正在输入">
      <span className={`streaming-dot w-1.5 h-1.5 rounded-full ${isDark ? "bg-zinc-400" : "bg-gray-400"}`} />
      <span className={`streaming-dot w-1.5 h-1.5 rounded-full ${isDark ? "bg-zinc-400" : "bg-gray-400"}`} />
      <span className={`streaming-dot w-1.5 h-1.5 rounded-full ${isDark ? "bg-zinc-400" : "bg-gray-400"}`} />
    </span>
  )
}

interface MarkdownContentProps {
  content: string
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return <MarkdownRenderer content={content} />
}

import { Star } from "lucide-react"
import { useChatStore } from "../../stores/chat"

function StarButton({ messageId, content }: { messageId: string; content: string }) {
  const addFavorite = useChatStore((s) => s.addFavorite)
  const favorites = useChatStore((s) => s.favorites)
  const isFaved = favorites.some((f) => f.messageId === messageId)

  return (
    <button
      onClick={() => { if (!isFaved) addFavorite(messageId, content) }}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:bg-white/10 transition-all ${
        isFaved ? "text-yellow-500 opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
      aria-label={isFaved ? "已收藏" : "收藏"}
      title="收藏"
    >
      <Star size={12} fill={isFaved ? "currentColor" : "none"} />
      <span>{isFaved ? "已收藏" : "收藏"}</span>
    </button>
  )
}
