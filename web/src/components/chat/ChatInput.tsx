import { useCallback, useRef, useState } from "react"
import { Send, Square } from "lucide-react"
import { lazy, Suspense } from "react"
import { useTheme } from "../../theme"
const ModelSelector = lazy(() => import("../ModelSelector"))

interface ChatInputProps {
  isStreaming: boolean
  onSend: (text: string) => void
  onAbort: () => void
}

export default function ChatInput({ isStreaming, onSend, onAbort }: ChatInputProps) {
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    setInput("")
    onSend(trimmed)
  }, [input, isStreaming, onSend])

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className={`border-t p-3 md:p-4 ${isDark ? "border-zinc-800" : "border-gray-200"}`}>
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3">
        <Suspense fallback={<div className={`h-8 w-full md:min-w-[180px] animate-pulse rounded ${isDark ? "bg-zinc-800" : "bg-gray-100"}`} />}>
          <ModelSelector className="w-full md:w-auto md:min-w-[180px]" />
        </Suspense>
        <div className={`flex-1 flex items-end gap-2 rounded-xl border px-3 py-2 focus-within:border-zinc-500 transition-colors ${isDark ? "border-zinc-700 bg-zinc-900" : "border-gray-300 bg-white"}`}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Type a message..."
            rows={1}
            aria-label="输入消息"
            className={`flex-1 resize-none bg-transparent text-sm outline-none max-h-32 ${isDark ? "text-zinc-100 placeholder:text-zinc-600" : "text-gray-900 placeholder:text-gray-400"}`}
            style={{ minHeight: "24px" }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = "auto"
              el.style.height = Math.min(el.scrollHeight, 128) + "px"
            }}
          />
          {isStreaming ? (
            <button
              onClick={onAbort}
              className="shrink-0 rounded-lg bg-red-600 p-1.5 text-white hover:bg-red-500 transition-colors"
              aria-label="Stop generating"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="shrink-0 rounded-lg bg-blue-600 p-1.5 text-white hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 transition-colors"
              aria-label="Send message"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function useChatInput() {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fillInput = useCallback((text: string) => {
    inputRef.current && (inputRef.current.value = text)
    inputRef.current?.focus()
  }, [])
  return { inputRef, fillInput }
}
