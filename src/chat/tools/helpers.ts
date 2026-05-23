export function buildTree(lines: string[]): string {
  const root: Record<string, string[]> = {}
  for (const line of lines) {
    const clean = line.replace(/^\.\//, "")
    if (!clean) continue
    const parts = clean.split("/")
    const dir = parts.slice(0, -1).join("/")
    const file = parts[parts.length - 1]
    if (!root[dir]) root[dir] = []
    root[dir].push(file)
  }

  const result: string[] = []
  const sortedDirs = Object.keys(root).sort()

  for (const dir of sortedDirs) {
    if (!dir) {
      const files = root[""].filter(f => !f.includes(".") || f === ".").sort()
      result.push(...files.map(f => f))
      continue
    }
    const indent = dir.split("/").map(() => "│   ").join("").slice(0, -4) + "├── "
    const dirName = dir.split("/").pop() || dir
    result.push(`${indent}${dirName}/`)
    const items = (root[dir] || []).sort()
    for (const item of items) {
      const itemIndent = dir.split("/").map(() => "│   ").join("")
      result.push(`${itemIndent}├── ${item}`)
    }
  }

  return result.join("\n")
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
