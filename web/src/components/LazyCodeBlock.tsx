import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Copy, Check } from "lucide-react"
import ts from "react-syntax-highlighter/dist/esm/languages/prism/typescript"
import js from "react-syntax-highlighter/dist/esm/languages/prism/javascript"
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx"
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx"
import python from "react-syntax-highlighter/dist/esm/languages/prism/python"
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash"
import json from "react-syntax-highlighter/dist/esm/languages/prism/json"
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml"
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql"
import css from "react-syntax-highlighter/dist/esm/languages/prism/css"
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup"
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown"
import go from "react-syntax-highlighter/dist/esm/languages/prism/go"
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust"
import java from "react-syntax-highlighter/dist/esm/languages/prism/java"
import c from "react-syntax-highlighter/dist/esm/languages/prism/c"
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp"
import docker from "react-syntax-highlighter/dist/esm/languages/prism/docker"
import shellSession from "react-syntax-highlighter/dist/esm/languages/prism/shell-session"

const languages = [ts, js, jsx, tsx, python, bash, json, yaml, sql, css, markup, markdown, go, rust, java, c, cpp, docker, shellSession]
languages.forEach((lang) => SyntaxHighlighter.registerLanguage(lang.name, lang))

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
