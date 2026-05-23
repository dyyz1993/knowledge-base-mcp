import type { ReactNode } from "react"
import CopyButton from "../CopyButton"
import { MarkdownRenderer } from "../MarkdownRenderer"

interface ThinkingMessageProps {
  content: string
  streaming?: boolean
}

export function ThinkingMessage({ content, streaming }: ThinkingMessageProps) {
  return (
    <div className="mx-auto max-w-[80%] md:max-w-[80%] rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500 italic">
      <span className="font-medium text-zinc-400">{streaming ? "Thinking..." : "Thinking"}</span>
      <p className="mt-1 whitespace-pre-wrap">{content}</p>
    </div>
  )
}

interface AssistantMessageProps {
  content: string
  messageKey: string
}

export function AssistantMessage({ content, messageKey }: AssistantMessageProps) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] md:max-w-[80%] rounded-2xl bg-zinc-800 text-zinc-200 px-4 py-2.5 text-sm">
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
    <div className="flex justify-end">
      <div className="max-w-[85%] md:max-w-[80%] rounded-2xl bg-blue-600 text-white px-4 py-2.5 text-sm leading-relaxed">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  )
}

export function StreamingIndicator() {
  return (
    <span className="inline-flex gap-1 ml-1">
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
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
      title="收藏"
    >
      <Star size={12} fill={isFaved ? "currentColor" : "none"} />
      <span>{isFaved ? "已收藏" : "收藏"}</span>
    </button>
  )
}
