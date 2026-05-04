import { useState } from "react"
import { Copy, Check } from "lucide-react"

export default function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <button onClick={copy} className={`p-1 rounded hover:bg-zinc-700 transition-colors ${className}`} title="Copy">
      {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} className="text-zinc-500" />}
    </button>
  )
}
