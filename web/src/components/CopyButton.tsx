import { useState } from "react"
import { Copy, Check } from "lucide-react"
import { useTheme } from "../theme"

export default function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const { theme } = useTheme()
  const isDark = theme === "dark"

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button
      onClick={copy}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? "hover:bg-white/10" : "hover:bg-black/10"} ${className}`}
      title="复制"
      aria-label={copied ? "已复制" : "复制内容"}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? "已复制" : "复制"}</span>
    </button>
  )
}
