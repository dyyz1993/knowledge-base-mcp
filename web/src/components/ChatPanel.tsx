import { useEffect, useRef, useState, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import { Send, Square, ChevronDown, ChevronRight, Wrench, Loader2 } from "lucide-react"
import { useChatStore } from "../stores/chat"

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

function StreamingIndicator() {
  return (
    <span className="inline-flex gap-1 ml-1">
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
      <span className="streaming-dot w-1.5 h-1.5 rounded-full bg-zinc-400" />
    </span>
  )
}

export default function ChatPanel() {
  const {
    messages,
    isStreaming,
    streamingContent,
    streamingThinking,
    streamingToolCalls,
    sendMessage,
    abort,
  } = useChatStore()
  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streamingContent, streamingToolCalls])

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            Send a message to start chatting
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-200"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="markdown-body">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {isStreaming && streamingToolCalls.map((tc, i) => (
          <ToolCallBlock key={`tc-${i}`} name={tc.name} args={tc.args} result={tc.result} />
        ))}

        {isStreaming && streamingThinking && (
          <div className="mx-auto max-w-[80%] rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500 italic">
            <span className="font-medium text-zinc-400">Thinking...</span>
            <p className="mt-1 whitespace-pre-wrap">{streamingThinking}</p>
          </div>
        )}

        {isStreaming && streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl bg-zinc-800 text-zinc-200 px-4 py-2.5 text-sm">
              <div className="markdown-body">
                <ReactMarkdown>{streamingContent}</ReactMarkdown>
                <StreamingIndicator />
              </div>
            </div>
          </div>
        )}

        {isStreaming && !streamingContent && !streamingThinking && streamingToolCalls.length === 0 && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-zinc-800 text-zinc-400 px-4 py-2.5 text-sm flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              <span>Thinking</span>
              <StreamingIndicator />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 p-3">
        <div className="flex items-end gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 focus-within:border-zinc-500 transition-colors">
          <textarea
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
  )
}
