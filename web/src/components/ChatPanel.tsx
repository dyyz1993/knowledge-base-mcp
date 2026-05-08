import { useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Send, Square, ChevronDown, ChevronRight, Wrench, Loader2, Star } from "lucide-react"
import { useChatStore, type TimelineEvent } from "../stores/chat"
import CopyButton from "./CopyButton"
import ModelSelector from "./ModelSelector"

interface MergedEvent {
  type: "thinking" | "text" | "tool_call" | "tool_result"
  round: number
  content: string
  name?: string
  args?: string
  result?: string
}

function mergeTimelineEvents(events: TimelineEvent[]): MergedEvent[] {
  const merged: MergedEvent[] = []
  for (const event of events) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.type === event.type &&
      last.round === event.round &&
      (event.type === "thinking" || event.type === "text")
    ) {
      last.content += event.content
    } else {
      merged.push({ ...event })
    }
  }
  return merged
}

function ToolCallBlock({ name, args, result }: { name: string; args: string; result: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1.5 rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={13} />
        <span className="font-medium text-zinc-300">{name}</span>
        {!result && <Loader2 size={12} className="animate-spin text-zinc-500" />}
      </button>
      {open && (
        <div className="border-t border-zinc-800 px-3 py-2 text-xs space-y-2">
          {args && (
            <div>
              <span className="text-zinc-500">Args:</span>
              <pre className="mt-1 rounded bg-zinc-950 p-2 text-zinc-300 overflow-x-auto">{args}</pre>
            </div>
          )}
          {result && (
            <div>
              <span className="text-zinc-500">Result:</span>
              <pre className="mt-1 rounded bg-zinc-950 p-2 text-zinc-300 overflow-x-auto max-h-48 overflow-y-auto">{result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function CodeBlock({ children, className }: { children?: ReactNode; className?: string }) {
  const match = /language-(\w+)/.exec(className || "")
  const code = String(children).replace(/\n$/, "")
  const language = match ? match[1] : ""

  if (!className) {
    return (
      <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300 font-mono">
        {children}
      </code>
    )
  }

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-zinc-700/50">
      <div className="flex items-center justify-between bg-zinc-800 px-3 py-1 text-xs text-zinc-500 border-b border-zinc-700/50">
        <span>{language || "code"}</span>
        <CopyButton text={code} className="opacity-0 group-hover:opacity-100 -mr-1 -mt-0.5" />
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || "text"}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: 0, fontSize: "13px", background: "#18181b" }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

function StreamingIndicator() {
  return (
    <span className="inline-flex gap-1 ml-1">
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
    </span>
  )
}

const markdownComponents = {
  code({ children, className }: { children?: ReactNode; className?: string }) {
    return <CodeBlock className={className}>{children}</CodeBlock>
  },
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  )
}

function SuggestionButtons({ suggestions, onFill }: { suggestions: string[]; onFill: (text: string) => void }) {
  if (suggestions.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onFill(s)}
          className="px-3 py-1.5 text-xs rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors cursor-pointer"
        >
          {s}
        </button>
      ))}
    </div>
  )
}

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

export default function ChatPanel() {
  const currentSessionId = useChatStore((s) => s.currentSessionId)
  const streamState = useChatStore((s) =>
    s.currentSessionId ? s.streamStates.get(s.currentSessionId) : undefined
  )
  const messages = useChatStore((s) => s.messages)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const abort = useChatStore((s) => s.abort)

  const isStreaming = streamState?.isStreaming ?? false
  const streamingTimeline = streamState?.streamingTimeline ?? []
  const streamingContent = streamState?.streamingContent ?? ""
  const suggestions = streamState?.suggestions ?? []

  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isAtBottomRef = useRef(true)

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50
  }, [])

  useEffect(() => {
    if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [isStreaming, streamingTimeline, messages, streamingContent])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    setInput("")
    sendMessage(trimmed)
  }, [input, isStreaming, sendMessage])

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  const handleSuggestionFill = useCallback((text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }, [])

  const merged = mergeTimelineEvents(streamingTimeline)

  return (
    <div className="flex flex-col h-full">
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 md:px-4 py-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            Send a message to start chatting
          </div>
        )}

        {(() => {
          const rendered: ReactNode[] = []
          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i]
            if (msg.role === "thinking") {
              rendered.push(
                <div key={i} className="mx-auto max-w-[80%] md:max-w-[80%] rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500 italic">
                  <span className="font-medium text-zinc-400">Thinking</span>
                  <p className="mt-1 whitespace-pre-wrap">{msg.content}</p>
                </div>
              )
            } else if (msg.role === "tool_call") {
              const nextMsg = messages[i + 1]
              const result = nextMsg?.role === "tool_result" ? nextMsg.content : ""
              rendered.push(
                <ToolCallBlock
                  key={i}
                  name={msg.name || ""}
                  args={msg.args || ""}
                  result={result}
                />
              )
            } else if (msg.role === "tool_result") {
              continue
            } else if (msg.role === "assistant") {
              rendered.push(
                <div key={i} className="flex justify-start">
                  <div className="max-w-[85%] md:max-w-[80%] rounded-2xl bg-zinc-800 text-zinc-200 px-4 py-2.5 text-sm">
                    <div className="group relative markdown-body">
                      <MarkdownContent content={msg.content} />
                      <div className="mt-1.5 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ marginTop: "4px" }}>
                        <CopyButton text={msg.content} className="-mb-1" />
                        <StarButton messageId={String(i)} content={msg.content} />
                      </div>
                    </div>
                  </div>
                </div>
              )
            } else {
              rendered.push(
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] md:max-w-[80%] rounded-2xl bg-blue-600 text-white px-4 py-2.5 text-sm leading-relaxed">
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              )
            }
          }
          return rendered
        })()}

        {isStreaming && streamingContent?.includes("[SUGGESTIONS]") && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            正在生成推荐话题...
          </div>
        )}

        {!isStreaming && suggestions.length > 0 && (
          <SuggestionButtons suggestions={suggestions} onFill={handleSuggestionFill} />
        )}

        {isStreaming && merged.length === 0 && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-zinc-800 text-zinc-400 px-4 py-2.5 text-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Thinking</span>
              <StreamingIndicator />
            </div>
          </div>
        )}

        {isStreaming && merged.map((event, i) => {
          switch (event.type) {
            case "thinking":
              return (
                <div key={`tl-${i}`} className="mx-auto max-w-[80%] md:max-w-[80%] rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500 italic">
                  <span className="font-medium text-zinc-400">Thinking...</span>
                  <p className="mt-1 whitespace-pre-wrap">{event.content}</p>
                </div>
              )
            case "text": {
              const displayContent = event.content
                .replace(/\[SUGGESTIONS\][\s\S]*?(?:\[\/SUGGESTIONS\]|$)/, "")
                .trim()
              if (!displayContent) return null
              return (
                <div key={`tl-${i}`} className="flex justify-start">
                  <div className="max-w-[85%] md:max-w-[80%] rounded-2xl bg-zinc-800 text-zinc-200 px-4 py-2.5 text-sm">
                    <div className="group relative markdown-body">
                      <MarkdownContent content={displayContent} />
                      <StreamingIndicator />
                      <div className="mt-1 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <CopyButton text={displayContent} className="-mr-1 -mb-0.5" />
                      </div>
                    </div>
                  </div>
                </div>
              )
            }
            case "tool_call":
              return (
                <ToolCallBlock
                  key={`tl-${i}`}
                  name={event.name || ""}
                  args={event.args || ""}
                  result={event.result || ""}
                />
              )
            case "tool_result":
              return null
          }
        })}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 p-3 md:p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-3">
          <ModelSelector className="w-full md:w-auto md:min-w-[180px]" />
          <div className="flex-1 flex items-end gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 focus-within:border-zinc-500 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-zinc-100 placeholder-zinc-600 outline-none max-h-32"
              style={{ minHeight: "24px" }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = "auto"
                el.style.height = Math.min(el.scrollHeight, 128) + "px"
              }}
            />
            {isStreaming ? (
              <button
                onClick={abort}
                className="shrink-0 rounded-lg bg-red-600 p-1.5 text-white hover:bg-red-500 transition-colors"
              >
                <Square size={16} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="shrink-0 rounded-lg bg-blue-600 p-1.5 text-white hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 transition-colors"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
