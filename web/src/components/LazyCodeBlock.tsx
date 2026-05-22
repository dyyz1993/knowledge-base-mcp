import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Copy, Check } from "lucide-react"

export default function LazyCodeBlock({ language, code, copied, onCopy }: { language?: string; code: string; copied: boolean; onCopy: () => void }) {
  return (
    <div className="my-4 rounded-lg overflow-hidden border border-zinc-800">
      <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900 text-xs text-zinc-500">
        <span className="font-mono">{language || "text"}</span>
        <button onClick={onCopy} className="flex items-center gap-1 hover:text-zinc-300 transition-colors">
          {copied ? <><Check size={12} className="text-green-400" /></> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language || "text"}
        PreTag="div"
        customStyle={{ margin: 0, borderRadius: 0, fontSize: "13px", background: "#1a1a2e" }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
