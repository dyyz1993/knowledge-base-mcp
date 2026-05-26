import { type ReactNode, useState, useEffect, Suspense, type ComponentType } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import CopyButton from "./CopyButton"
import { useTheme } from "../theme"

type SHProps = {
  style: Record<string, unknown>
  language: string
  PreTag: string
  customStyle: Record<string, unknown>
  children: string
}

function LazyHighlighter({ language, code, isDark }: { language: string; code: string; isDark: boolean }) {
  const [Component, setComponent] = useState<ComponentType<SHProps> | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [styles, mod, ...langs] = await Promise.all([
        import("react-syntax-highlighter/dist/esm/styles/prism"),
        import("react-syntax-highlighter/dist/esm/prism-light"),
        import("react-syntax-highlighter/dist/esm/languages/prism/typescript"),
        import("react-syntax-highlighter/dist/esm/languages/prism/javascript"),
        import("react-syntax-highlighter/dist/esm/languages/prism/jsx"),
        import("react-syntax-highlighter/dist/esm/languages/prism/tsx"),
        import("react-syntax-highlighter/dist/esm/languages/prism/python"),
        import("react-syntax-highlighter/dist/esm/languages/prism/bash"),
        import("react-syntax-highlighter/dist/esm/languages/prism/json"),
        import("react-syntax-highlighter/dist/esm/languages/prism/yaml"),
        import("react-syntax-highlighter/dist/esm/languages/prism/sql"),
        import("react-syntax-highlighter/dist/esm/languages/prism/css"),
        import("react-syntax-highlighter/dist/esm/languages/prism/markup"),
        import("react-syntax-highlighter/dist/esm/languages/prism/markdown"),
        import("react-syntax-highlighter/dist/esm/languages/prism/go"),
        import("react-syntax-highlighter/dist/esm/languages/prism/rust"),
        import("react-syntax-highlighter/dist/esm/languages/prism/java"),
        import("react-syntax-highlighter/dist/esm/languages/prism/c"),
        import("react-syntax-highlighter/dist/esm/languages/prism/cpp"),
        import("react-syntax-highlighter/dist/esm/languages/prism/docker"),
        import("react-syntax-highlighter/dist/esm/languages/prism/shell-session"),
      ])
      if (cancelled) return
      langs.forEach((lang) => {
        if (lang.default) mod.default.registerLanguage(lang.default.name || lang.default, lang.default)
      })
      const style = isDark ? styles.oneDark : styles.oneLight as Record<string, unknown>
      const SH = mod.default as unknown as ComponentType<SHProps>
      const Wrapped = (props: SHProps) => <SH {...props} style={style} />
      setComponent(() => Wrapped)
    })()
    return () => { cancelled = true }
  }, [isDark])

  if (!Component) {
    return <div className={`h-20 animate-pulse ${isDark ? "bg-zinc-800" : "bg-gray-100"}`} />
  }

  return (
    <Component
      style={{}}
      language={language || "text"}
      PreTag="div"
      customStyle={{ margin: 0, borderRadius: 0, fontSize: "13px", background: isDark ? "#18181b" : "#f5f5f5" }}
    >
      {code}
    </Component>
  )
}

function CodeBlock({ children, className, ...rest }: { children?: ReactNode; className?: string; [key: string]: unknown }) {
  const match = /language-(\w+)/.exec(className || "")
  const code = String(children).replace(/\n$/, "")
  const language = match ? match[1] : ""
  const { theme } = useTheme()
  const isDark = theme === "dark"

  if (!className) {
    return (
      <code className={`rounded px-1.5 py-0.5 text-xs font-mono ${isDark ? "bg-zinc-900 text-zinc-300" : "bg-gray-100 text-gray-800"}`} {...rest}>
        {children}
      </code>
    )
  }

  return (
    <div className={`relative group my-2 rounded-lg overflow-x-auto border ${isDark ? "border-zinc-700/50" : "border-gray-200"}`}>
      <div className={`flex items-center justify-between px-3 py-1 text-xs border-b ${isDark ? "bg-zinc-800 text-zinc-500 border-zinc-700/50" : "bg-gray-100 text-gray-500 border-gray-200"}`}>
        <span>{language || "code"}</span>
        <CopyButton text={code} className="opacity-0 group-hover:opacity-100 -mr-1 -mt-0.5" />
      </div>
      <Suspense fallback={<div className={`h-20 animate-pulse ${isDark ? "bg-zinc-800" : "bg-gray-100"}`} />}>
        <LazyHighlighter language={language} code={code} isDark={isDark} />
      </Suspense>
    </div>
  )
}

export const sharedMarkdownComponents = {
  pre({ children }: { children?: ReactNode }) {
    return <>{children}</>
  },
  code(props: React.ClassAttributes<HTMLElement> & React.HTMLAttributes<HTMLElement> & { node?: unknown }) {
    const { children, className, node, ...rest } = props
    return <CodeBlock className={className} {...rest}>{children}</CodeBlock>
  },
}

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={sharedMarkdownComponents}>
      {content}
    </ReactMarkdown>
  )
}
