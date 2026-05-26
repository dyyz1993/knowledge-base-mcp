import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import DOMPurify from "dompurify"
import { Copy, Check, ExternalLink, Clock, Tag, FileText, ClipboardCopy } from "lucide-react"
import type { DocMeta } from "../services/api"
import TagBadge from "./TagBadge"
import { DocSkeleton } from "./Skeleton"
import { useTheme } from "../theme"

const LazyCodeBlock = lazy(() => import("./LazyCodeBlock"))

function useCopy(timeout = 1500) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), timeout)
  }, [timeout])
  return { copied, copy }
}

function CopyBtn({ text, size = 12, isDark = true }: { text: string; size?: number; isDark?: boolean }) {
  const { copied, copy } = useCopy()
  return (
    <button onClick={() => copy(text)} className={`flex items-center gap-1 transition-colors ${isDark ? "hover:text-zinc-300 text-zinc-500" : "hover:text-gray-600 text-gray-400"}`} aria-label="复制代码">
      {copied ? <><Check size={size} className="text-green-400" /> <span className="text-green-400">Copied!</span></> : <><Copy size={size} /> Copy</>}
    </button>
  )
}

function CodeBlockWrapper({ language, children, isDark }: { language?: string; children: string; isDark: boolean }) {
  const { copied, copy } = useCopy()
  return (
    <Suspense fallback={<div className={`my-4 h-32 animate-pulse rounded-lg ${isDark ? "bg-zinc-800" : "bg-gray-100"}`} />}>
      <LazyCodeBlock language={language} code={children} copied={copied} onCopy={() => copy(children)} isDark={isDark} />
    </Suspense>
  )
}

const svgPurify = DOMPurify()
svgPurify.addHook("uponSanitizeElement", (node) => {
  if (node.nodeName === "script") (node as Element).remove()
})

function sanitizeSvg(svg: string): string {
  return svgPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use"],
    ADD_ATTR: ["xlink:href"],
  })
}

function MermaidBlock({ code, isDark }: { code: string; isDark: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ref.current || !code.trim()) return
    let cancelled = false
    ;(async () => {
      const m = await import("mermaid")
      if (cancelled) return
      m.default.initialize({
        startOnLoad: false,
        theme: isDark ? "dark" : "default",
        themeVariables: isDark
          ? { background: "#18181b", primaryColor: "#3b82f6" }
          : { background: "#ffffff", primaryColor: "#3b82f6" }
      })
      const id = "mermaid-" + Math.random().toString(36).slice(2, 8)
      try {
        const { svg } = await m.default.render(id, code)
        if (!cancelled && ref.current) {
          try {
            ref.current.innerHTML = sanitizeSvg(svg)
          } catch {
            ref.current.textContent = svg
          }
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [code, isDark])

  if (error) return <pre className="bg-red-950/30 border border-red-900 p-3 rounded-lg text-red-400 text-sm">{error}</pre>
  return <div ref={ref} className="my-4 flex justify-center [&_svg]:max-w-full min-h-[192px]">
    {!ref.current?.innerHTML && <div className={`w-full h-48 animate-pulse rounded ${isDark ? "bg-zinc-800" : "bg-gray-100"}`} />}
  </div>
}

function proseClasses(isDark: boolean): string {
  const base = [
    "max-w-4xl mx-auto px-8 py-6",
    isDark ? "prose prose-invert prose-zinc" : "prose prose-gray",
    "[&_h1]:text-xl [&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:pb-2 [&_h1]:border-b",
    isDark ? "[&_h1]:border-zinc-800" : "[&_h1]:border-gray-200",
    "[&_h2]:text-lg [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:pb-1 [&_h2]:border-b",
    isDark ? "[&_h2]:border-zinc-800/50" : "[&_h2]:border-gray-200/50",
    "[&_h3]:text-base [&_h3]:mt-5 [&_h3]:mb-2",
    "[&_p]:mb-4 [&_p]:leading-7",
    "[&_ul]:mb-4 [&_ol]:mb-4 [&_li]:leading-7",
    "[&_blockquote]:border-l-3 [&_blockquote]:border-blue-500/50",
    isDark ? "[&_blockquote]:bg-blue-950/20" : "[&_blockquote]:bg-blue-50",
    "[&_blockquote]:rounded-r-lg [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:my-4",
    "[&_a]:text-blue-400 [&_a]:no-underline [&_a:hover]:underline",
    isDark ? "[&_strong]:text-zinc-100" : "[&_strong]:text-gray-900",
    isDark ? "[&_em]:text-zinc-300" : "[&_em]:text-gray-600",
    isDark ? "[&_hr]:border-zinc-800" : "[&_hr]:border-gray-200",
    "[&_hr]:my-6",
    "[&_img]:rounded-lg [&_img]:max-w-full",
    "[&_table]:w-full [&_table]:border-collapse [&_table]:my-4 [&_table]:text-sm",
    isDark ? "[&_th]:bg-zinc-800 [&_th]:text-zinc-200" : "[&_th]:bg-gray-100 [&_th]:text-gray-800",
    "[&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:border [&_th]:font-semibold",
    isDark ? "[&_th]:border-zinc-700" : "[&_th]:border-gray-300",
    "[&_td]:px-3 [&_td]:py-2 [&_td]:border",
    isDark ? "[&_td]:border-zinc-700 [&_td]:text-zinc-300" : "[&_td]:border-gray-300 [&_td]:text-gray-700",
    isDark ? "[&_tr:hover_td]:bg-zinc-800/50" : "[&_tr:hover_td]:bg-gray-50",
    "[&_code]:text-pink-300",
    isDark ? "[&_code]:bg-zinc-800/80" : "[&_code]:bg-gray-100",
    "[&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px] [&_code]:font-mono",
    "[&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:m-0",
  ]
  return base.join(" ")
}

export default function DocViewer({ doc, loading }: { doc: { meta: DocMeta; content: string; truncated: boolean } | null; loading?: boolean }) {
  const { copied, copy } = useCopy()
  const scrollRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0)
  }, [doc?.meta.id])

  if (loading && !doc) {
    return <div className="flex-1"><DocSkeleton /></div>
  }

  if (!doc) {
    return (
      <div className={`flex-1 flex items-center justify-center ${isDark ? "text-zinc-600" : "text-gray-500"}`}>
        <div className="text-center">
          <Tag size={48} className="mx-auto mb-4 opacity-30" />
          <p>Select a document to view</p>
        </div>
      </div>
    )
  }

  const { meta, content, truncated } = doc
  const date = new Date(meta.created_at).toLocaleString("zh-CN")

  const refText = `使用 kb_read 工具读取文档，传入 id: "${meta.id}"
文档标题: ${meta.title}
文件路径: ${meta.file_path}
来源项目: ${meta.source_project}`

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto" role="article" aria-label={doc ? doc.meta.title : "文档查看器"}>
      <div className={`sticky top-0 z-10 backdrop-blur border-b px-8 py-2 flex items-center gap-3 ${isDark ? "bg-zinc-950/90 border-zinc-800" : "bg-white/95 border-gray-200"}`}>
        <FileText size={14} className={isDark ? "text-zinc-500" : "text-gray-500"} />
        <span className={`text-sm truncate flex-1 ${isDark ? "text-zinc-300" : "text-gray-800"}`}>{meta.title}</span>
        <span className={`text-xs font-mono ${isDark ? "text-zinc-600" : "text-gray-400"}`}>{meta.id}</span>
        <button
          onClick={() => copy(refText)}
          aria-label="复制文档引用"
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs border transition-all ${copied ? "bg-green-900/30 border-green-700 text-green-400" : (isDark ? "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" : "bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200 hover:text-gray-800")}`}
        >
          <ClipboardCopy size={13} />
          {copied ? "Copied!" : "Copy Reference"}
        </button>
      </div>

      <div className={proseClasses(isDark)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || "")
              const code = String(children).replace(/\n$/, "")
              if (match) {
                const lang = match[1]
                if (lang === "mermaid") return <MermaidBlock code={code} isDark={isDark} />
                return <CodeBlockWrapper language={lang} isDark={isDark}>{code}</CodeBlockWrapper>
              }
              return <code className={className} {...props}>{children}</code>
            },
            pre({ children }) {
              return <>{children}</>
            },
            table({ children }) {
              return (
                <div className={`overflow-x-auto my-4 rounded-lg border ${isDark ? "border-zinc-700" : "border-gray-300"}`}>
                  <table className="w-full border-collapse">{children}</table>
                </div>
              )
            },
            th({ children }) {
              return <th className={`${isDark ? "bg-zinc-800 text-zinc-200" : "bg-gray-100 text-gray-800"} px-3 py-2 text-left border font-semibold text-sm ${isDark ? "border-zinc-700" : "border-gray-300"}`}>{children}</th>
            },
            td({ children }) {
              return <td className={`px-3 py-2 border text-sm ${isDark ? "border-zinc-700 text-zinc-300" : "border-gray-300 text-gray-700"}`}>{children}</td>
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>

      {truncated && (
        <div className={`mt-4 p-3 rounded-lg text-sm ${isDark ? "bg-yellow-900/20 border border-yellow-800/50 text-yellow-300" : "bg-yellow-50 border border-yellow-200 text-yellow-700"}`}>
          Document truncated. Full path: <code className={isDark ? "text-yellow-200" : "text-yellow-600"}>{meta.file_path}</code>
        </div>
      )}
    </div>
  )
}
