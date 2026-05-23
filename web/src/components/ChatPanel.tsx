import { useEffect, useRef, useCallback, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { useChatStore, type TimelineEvent } from "../stores/chat"
import type { TokenUsage } from "../services/api"
import CopyButton from "./CopyButton"
import ChatInput from "./chat/ChatInput"
import { ToolCallBlock, ResearchProgressBar } from "./chat/ToolCallDisplay"
import { ThinkingMessage, AssistantMessage, UserMessage, StreamingIndicator, MarkdownContent } from "./chat/ChatMessage"

interface MergedEvent {
  type: "thinking" | "text" | "tool_call" | "tool_result"
  round: number
  content: string
  id?: string
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

function calculateCost(usage: TokenUsage): number {
  const OUTPUT_PRICE = 40 / 1_000_000
  const INPUT_PRICE = OUTPUT_PRICE / 5
  const CACHE_READ_PRICE = OUTPUT_PRICE / 10
  const CACHE_WRITE_PRICE = OUTPUT_PRICE

  const outputCost = (usage.completion_tokens || 0) * OUTPUT_PRICE
  const inputCost = ((usage.prompt_tokens || 0) - (usage.cache_read_tokens || 0) - (usage.cache_write_tokens || 0)) * INPUT_PRICE
  const cacheReadCost = (usage.cache_read_tokens || 0) * CACHE_READ_PRICE
  const cacheWriteCost = (usage.cache_write_tokens || 0) * CACHE_WRITE_PRICE

  return outputCost + inputCost + cacheReadCost + cacheWriteCost
}

function UsageBar({ usage }: { usage: TokenUsage }) {
  const total = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0)
  const cost = calculateCost(usage)
  return (
    <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-600 select-none">
      <span>Tokens: {total.toLocaleString()}</span>
      <span>Cost: ¥{cost.toFixed(4)}</span>
      {usage.cache_read_tokens > 0 && <span>Cache Hit: {usage.cache_read_tokens.toLocaleString()}</span>}
    </div>
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

function MessageList({ messages }: { messages: Array<{ role: string; content: string; name?: string; args?: string }> }) {
  const rendered: ReactNode[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === "thinking") {
      rendered.push(
        <ThinkingMessage key={i} content={msg.content} />
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
        <AssistantMessage key={i} content={msg.content} messageKey={String(i)} />
      )
    } else {
      rendered.push(
        <UserMessage key={i} content={msg.content} />
      )
    }
  }
  return <>{rendered}</>
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
  const usage = streamState?.usage

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

  const handleSuggestionFill = useCallback((text: string) => {
    if (inputRef.current) {
      inputRef.current.value = text
      inputRef.current.focus()
    }
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

        <MessageList messages={messages} />

        {isStreaming && streamingContent?.includes("[SUGGESTIONS]") && (
          <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            正在生成推荐话题...
          </div>
        )}

        {!isStreaming && suggestions.length > 0 && (
          <SuggestionButtons suggestions={suggestions} onFill={handleSuggestionFill} />
        )}

        {!isStreaming && usage && (
          <UsageBar usage={usage} />
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
                <ThinkingMessage key={`tl-${i}`} content={event.content} streaming />
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
            case "tool_call": {
              const isResearch = event.name === "kb_research"
              const rp = isResearch ? (streamState?.researchProgress ?? []) : []
              return (
                <div key={`tl-${i}`}>
                  <ToolCallBlock
                    name={event.name || ""}
                    args={event.args || ""}
                    result={event.result || ""}
                  />
                  {isResearch && rp.length > 0 && <ResearchProgressBar progress={rp} />}
                </div>
              )
            }
            case "tool_result":
              return (
                <div key={`tl-${i}`} className="my-1 ml-4 rounded bg-zinc-900/50 px-3 py-1.5 text-xs text-zinc-400 max-h-32 overflow-y-auto">
                  <pre className="whitespace-pre-wrap">{event.content}</pre>
                </div>
              )
          }
        })}

        <div ref={bottomRef} />
      </div>

      <ChatInput
        isStreaming={isStreaming}
        onSend={sendMessage}
        onAbort={abort}
      />
    </div>
  )
}
