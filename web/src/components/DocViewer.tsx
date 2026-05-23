import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Copy, Check, ExternalLink, Clock, Tag, FileText, ClipboardCopy } from "lucide-react"
import type { DocMeta } from "../services/api"
import TagBadge from "./TagBadge"
import { DocSkeleton } from "./Skeleton"

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

function CopyBtn({ text, size = 12 }: { text: string; size?: number }) {
  const { copied, copy } = useCopy()
  return (
    <button onClick={() => copy(text)} className="flex items-center gap-1 hover:text-zinc-300 transition-colors text-zinc-500" aria-label="复制代码">
      {copied ? <><Check size={size} className="text-green-400" /> <span className="text-green-400">Copied!</span></> : <><Copy size={size} /> Copy</>}
    </button>
  )
}

function CodeBlockWrapper({ language, children }: { language?: string; children: string }) {
  const { copied, copy } = useCopy()
  return (
    <Suspense fallback={<div className="my-4 h-32 animate-pulse bg-zinc-800 rounded-lg" />}>
      <LazyCodeBlock language={language} code={children} copied={copied} onCopy={() => copy(children)} />
    </Suspense>
  )
}

const SVG_ALLOWED_TAGS = new Set([
  "svg", "g", "path", "circle", "rect", "line", "polyline", "polygon",
  "text", "tspan", "defs", "clipPath", "use", "title", "desc", "marker",
])

const SVG_ALLOWED_ATTRS = new Set([
  "d", "cx", "cy", "r", "x", "y", "width", "height", "fill", "stroke",
  "transform", "viewBox", "xmlns", "id", "href", "class", "style",
  "points", "offset", "stop-color", "stop-opacity", "font-size",
  "text-anchor", "dominant-baseline",
])

function sanitizeSvg(raw: string): string {
  const doc = new DOMParser().parseFromString(raw, "image/svg+xml")
  const errors = doc.querySelectorAll("parsererror")
  if (errors.length) throw new Error("Invalid SVG")

  const walk = (node: Element): void => {
    const children = Array.from(node.children)
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      if (!SVG_ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
        child.remove()
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith("on") || name === "src" || name === "href" && attr.value.startsWith("javascript:")) {
          child.removeAttributeNode(attr)
        } else if (!SVG_ALLOWED_ATTRS.has(name)) {
          child.removeAttributeNode(attr)
        }
      }
      walk(child)
    }
  }
  walk(doc.documentElement)
  const svg = doc.documentElement
  const ser = new XMLSerializer()
  return ser.serializeToString(svg)
}

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!ref.current || !code.trim()) return
    let cancelled = false
    import("mermaid").then(m => {
      if (cancelled) return
      m.default.initialize({ startOnLoad: false, theme: "dark", themeVariables: { background: "#18181b", primaryColor: "#3b82f6" } })
      const id = "mermaid-" + Math.random().toString(36).slice(2, 8)
      m.default.render(id, code).then(({ svg }) => {
        if (!cancelled && ref.current) {
          try {
            ref.current.innerHTML = sanitizeSvg(svg)
          } catch {
            ref.current.textContent = svg
          }
        }
      }).catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    })
    return () => { cancelled = true }
  }, [code])

  if (error) return <pre className="bg-red-950/30 border border-red-900 p-3 rounded-lg text-red-400 text-sm">{error}</pre>
  return <div ref={ref} className="my-4 flex justify-center [&_svg]:max-w-full min-h-[192px]">
    {!ref.current?.innerHTML && <div className="w-full h-48 animate-pulse bg-zinc-800 rounded" />}
  </div>
}

export default function DocViewer({ doc, loading }: { doc: { meta: DocMeta; content: string; truncated: boolean } | null; loading?: boolean }) {
  const { copied, copy } = useCopy()

  if (loading && !doc) {
    return <div className="flex-1"><DocSkeleton /></div>
  }

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-600">
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
    <div className="flex-1 overflow-y-auto" role="article" aria-label={doc ? doc.meta.title : "文档查看器"}>
      <div className="sticky top-0 z-10 bg-zinc-950/90 backdrop-blur border-b border-zinc-800 px-8 py-2 flex items-center gap-3">
        <FileText size={14} className="text-zinc-500" />
        <span className="text-sm text-zinc-300 truncate flex-1">{meta.title}</span>
        <span className="text-xs text-zinc-600 font-mono">{meta.id}</span>
        <button
          onClick={() => copy(refText)}
          aria-label="复制文档引用"
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs border transition-all ${copied ? "bg-green-900/30 border-green-700 text-green-400" : "bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
        >
          <ClipboardCopy size={13} />
          {copied ? "Copied!" : "Copy Reference"}
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-zinc-100 mb-3">{meta.title}</h1>
          <div className="flex items-center gap-4 text-xs text-zinc-500 mb-3">
            <span className="flex items-center gap-1"><Clock size={12} />{date}</span>
            <span className="flex items-center gap-1"><ExternalLink size={12} />{meta.source_project.split("/").pop()}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap mb-2">
            {meta.tags.map(t => <TagBadge key={t} tag={t} />)}
          </div>
          <div className="text-xs text-zinc-600">
            Keywords: {meta.keywords.join(", ")}
          </div>
        </div>

        <div className="prose prose-invert prose-zinc max-w-none
          [&_h1]:text-xl [&_h1]:mt-8 [&_h1]:mb-4 [&_h1]:pb-2 [&_h1]:border-b [&_h1]:border-zinc-800
          [&_h2]:text-lg [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:pb-1 [&_h2]:border-b [&_h2]:border-zinc-800/50
          [&_h3]:text-base [&_h3]:mt-5 [&_h3]:mb-2
          [&_p]:mb-4 [&_p]:leading-7
          [&_ul]:mb-4 [&_ol]:mb-4 [&_li]:leading-7
          [&_blockquote]:border-l-3 [&_blockquote]:border-blue-500/50 [&_blockquote]:bg-blue-950/20 [&_blockquote]:rounded-r-lg [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:my-4
          [&_a]:text-blue-400 [&_a]:no-underline [&_a:hover]:underline
          [&_strong]:text-zinc-100 [&_em]:text-zinc-300
          [&_hr]:border-zinc-800 [&_hr]:my-6
          [&_img]:rounded-lg [&_img]:max-w-full
          [&_table]:w-full [&_table]:border-collapse [&_table]:my-4 [&_table]:text-sm
          [&_th]:bg-zinc-800 [&_th]:text-zinc-200 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:border [&_th]:border-zinc-700 [&_th]:font-semibold
          [&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:border-zinc-700 [&_td]:text-zinc-300
          [&_tr:hover_td]:bg-zinc-800/50
          [&_code]:text-pink-300 [&_code]:bg-zinc-800/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[13px] [&_code]:font-mono
          [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:m-0
        ">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || "")
                const code = String(children).replace(/\n$/, "")
                if (match) {
                  const lang = match[1]
                  if (lang === "mermaid") return <MermaidBlock code={code} />
                  return <CodeBlockWrapper language={lang}>{code}</CodeBlockWrapper>
                }
                return <code className={className} {...props}>{children}</code>
              },
              pre({ children }) {
                return <>{children}</>
              },
              table({ children }) {
                return (
                  <div className="overflow-x-auto my-4 rounded-lg border border-zinc-700">
                    <table className="w-full border-collapse">{children}</table>
                  </div>
                )
              },
              th({ children }) {
                return <th className="bg-zinc-800 text-zinc-200 px-3 py-2 text-left border border-zinc-700 font-semibold text-sm">{children}</th>
              },
              td({ children }) {
                return <td className="px-3 py-2 border border-zinc-700 text-zinc-300 text-sm">{children}</td>
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>

        {truncated && (
          <div className="mt-4 p-3 bg-yellow-900/20 border border-yellow-800/50 rounded-lg text-yellow-300 text-sm">
            Document truncated. Full path: <code className="text-yellow-200">{meta.file_path}</code>
          </div>
        )}
      </div>
    </div>
  )
}
