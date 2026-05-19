import type { DocMeta } from "../storage/index.js"

export function renderRecentHtml(
  results: { meta: DocMeta; content?: string; snippet: string }[],
  hours: number,
): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  const fmtTime = (ms: number) => new Date(ms).toLocaleString("zh-CN", { hour12: false })
  const items = results.map(r => {
    const m = r.meta
    const tagsHtml = m.tags.map(t => `<span class="tag">${esc(t)}</span>`).join("")
    return `<article class="card">
  <div class="card-header">
    <h2><a href="/api/doc/${esc(m.id)}">${esc(m.title)}</a></h2>
    <time>${fmtTime(m.created_at)}</time>
  </div>
  <p class="intent">${esc(m.intent)}</p>
  <div class="tags">${tagsHtml}</div>
  <details><summary>摘要</summary><pre class="snippet">${esc(r.snippet)}</pre></details>
  ${r.content ? `<details open><summary>完整内容</summary><pre class="content">${esc(r.content)}</pre></details>` : ""}
  <div class="meta-footer">
    <span>${esc(m.project_description)}</span>
    ${m.source_project ? `<span class="project">${esc(m.source_project)}</span>` : ""}
  </div>
</article>`
  }).join("\n")

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>最近 ${hours} 小时的知识文档 (${results.length})</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0d1117;color:#c9d1d9;padding:24px;max-width:960px;margin:0 auto}
h1{margin-bottom:8px;font-size:1.5em;color:#58a6ff}
.summary{color:#8b949e;margin-bottom:24px}
.card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;margin-bottom:16px}
.card-header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px}
.card-header h2{font-size:1.15em;color:#58a6ff;word-break:break-all}
.card-header h2 a{color:inherit;text-decoration:none}
.card-header h2 a:hover{text-decoration:underline}
.card-header time{color:#8b949e;font-size:.85em;white-space:nowrap}
.intent{color:#d2a8ff;font-size:.9em;margin-bottom:8px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.tag{background:#1f6feb33;color:#58a6ff;padding:2px 8px;border-radius:12px;font-size:.8em}
details{margin-top:8px}
summary{cursor:pointer;color:#8b949e;font-size:.9em;user-select:none}
summary:hover{color:#c9d1d9}
pre{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:12px;margin-top:8px;white-space:pre-wrap;word-break:break-word;font-size:.85em;line-height:1.5;max-height:500px;overflow-y:auto}
.meta-footer{display:flex;justify-content:space-between;color:#8b949e;font-size:.8em;margin-top:10px;border-top:1px solid #30363d;padding-top:8px}
.project{color:#7ee787}
</style>
</head>
<body>
<h1>最近 ${hours} 小时的知识文档</h1>
<p class="summary">共 ${results.length} 条</p>
${items}
</body>
</html>`
}
