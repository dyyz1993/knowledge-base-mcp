import { type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import CopyButton from "./CopyButton"

function CodeBlock({ children, className, ...rest }: { children?: ReactNode; className?: string; [key: string]: unknown }) {
  const match = /language-(\w+)/.exec(className || "")
  const code = String(children).replace(/\n$/, "")
  const language = match ? match[1] : ""

  if (!className) {
    return (
      <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300 font-mono" {...rest}>
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
