import {
  searchDocs,
  searchDocsAdvanced,
  searchDocsSemantic,
  searchDocsCombined,
  writeDoc,
  readDoc,
  deleteDoc,
  listDocs,
  listRecentDocs,
  getOutline,
  getAllKeywords,
  rebuildAllVectors,
  readIndex,
} from "../storage/index.js"
import { kbAskPipeline } from "../search/kb-ask-pipeline.js"
import { getMissStats } from "../storage/miss-log.js"
import type { CliContext } from "./index.js"
import { vlog, vlogStep, formatDuration } from "./index.js"

type RunFn = (
  ctx: CliContext,
  positional: string[],
  flags: Record<string, string>,
  boolFlags: Set<string>,
) => Promise<number>

function output(data: unknown, format: string) {
  if (format === "json") {
    console.log(JSON.stringify(data, null, 2))
    return
  }
  if (typeof data === "string") {
    console.log(data)
    return
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      formatDocSummary(item)
    }
    return
  }
  console.log(JSON.stringify(data, null, 2))
}

function formatDocSummary(doc: Record<string, unknown>) {
  const id = String(doc.id || "")
  const title = String(doc.title || "")
  const score = doc.score != null ? ` (score: ${doc.score})` : ""
  const tags = Array.isArray(doc.tags) && doc.tags.length ? ` [${doc.tags.join(", ")}]` : ""
  const snippet = doc.snippet ? `\n  ${String(doc.snippet).slice(0, 120)}` : ""
  console.log(`\x1b[1m${id}\x1b[0m ${title}${score}${tags}${snippet}`)
}

function formatDocFull(meta: Record<string, unknown>, content: string) {
  console.log(`\x1b[1m=== ${meta.title} ===\x1b[0m`)
  console.log(`ID:       ${meta.id}`)
  console.log(`Tags:     ${(Array.isArray(meta.tags) ? meta.tags : []).join(", ")}`)
  console.log(`Keywords: ${(Array.isArray(meta.keywords) ? meta.keywords : []).join(", ")}`)
  if (meta.intent) console.log(`Intent:   ${meta.intent}`)
  if (meta.source_project) console.log(`Project:  ${meta.source_project}`)
  if (meta.created_at) console.log(`Created:  ${new Date(meta.created_at as number).toISOString()}`)
  if (meta.updated_at) console.log(`Updated:  ${new Date(meta.updated_at as number).toISOString()}`)
  console.log(`---`)
  console.log(content)
}

const searchToken: RunFn = async (ctx, positional, flags, boolFlags) => {
  const query = positional[0]
  if (!query) { console.error("Error: query required"); return 1 }
  const limit = parseInt(flags.limit || "10")
  const tags = flags.tags ? flags.tags.split(",") : undefined
  const keywords = flags.keywords ? flags.keywords.split(",") : undefined
  const format = flags.output || "text"

  vlogStep(ctx, "Token search", `query="${query}", limit=${limit}`)
  const t0 = Date.now()
  const results = searchDocs(query, keywords, tags, limit)
  vlogStep(ctx, "Search complete", `${results.length} results in ${formatDuration(Date.now() - t0)}`)

  if (format === "json") {
    output(results, format)
  } else {
    if (results.length === 0) { console.log("No results found."); return 0 }
    for (const r of results) formatDocSummary(r as unknown as Record<string, unknown>)
    console.log(`\n${results.length} result(s)`)
  }
  return 0
}

const searchTfidf: RunFn = async (ctx, positional, flags) => {
  const query = positional[0]
  if (!query) { console.error("Error: query required"); return 1 }
  const limit = parseInt(flags.limit || "10")
  const format = flags.output || "text"

  vlogStep(ctx, "TF-IDF search", `query="${query}", limit=${limit}`)
  const t0 = Date.now()
  const results = searchDocsAdvanced(query, limit)
  vlogStep(ctx, "Search complete", `${results.length} results in ${formatDuration(Date.now() - t0)}`)

  if (format === "json") { output(results, format) } else {
    if (results.length === 0) { console.log("No results found."); return 0 }
    for (const r of results) formatDocSummary(r as unknown as Record<string, unknown>)
    console.log(`\n${results.length} result(s)`)
  }
  return 0
}

const searchSemantic: RunFn = async (ctx, positional, flags) => {
  const query = positional[0]
  if (!query) { console.error("Error: query required"); return 1 }
  const limit = parseInt(flags.limit || "10")
  const format = flags.output || "text"

  vlogStep(ctx, "Semantic search", `query="${query}", limit=${limit}`)
  const t0 = Date.now()
  const results = await searchDocsSemantic(query, limit)
  vlogStep(ctx, "Search complete", `${results.length} results in ${formatDuration(Date.now() - t0)}`)

  if (format === "json") { output(results, format) } else {
    if (results.length === 0) { console.log("No results found."); return 0 }
    for (const r of results) formatDocSummary(r as unknown as Record<string, unknown>)
    console.log(`\n${results.length} result(s)`)
  }
  return 0
}

const searchCombined: RunFn = async (ctx, positional, flags, boolFlags) => {
  const query = positional[0]
  if (!query) { console.error("Error: query required"); return 1 }
  const limit = parseInt(flags.limit || "10")
  const tags = flags.tags ? flags.tags.split(",") : undefined
  const keywords = flags.keywords ? flags.keywords.split(",") : undefined
  const format = flags.output || "text"

  vlogStep(ctx, "Combined search", `query="${query}", limit=${limit}`)
  const t0 = Date.now()
  const results = await searchDocsCombined(query, keywords, tags, limit)
  vlogStep(ctx, "Search complete", `${results.length} results in ${formatDuration(Date.now() - t0)}`)

  if (format === "json") { output(results, format) } else {
    if (results.length === 0) { console.log("No results found."); return 0 }
    for (const r of results) formatDocSummary(r as unknown as Record<string, unknown>)
    console.log(`\n${results.length} result(s)`)
  }
  return 0
}

const listCmd: RunFn = async (ctx, positional, flags) => {
  const tag = flags.tag
  const project = flags.project
  const format = flags.output || "text"

  vlogStep(ctx, "List documents", tag ? `tag=${tag}` : project ? `project=${project}` : "all")
  const t0 = Date.now()
  const docs = listDocs(tag, project)
  vlogStep(ctx, "List complete", `${docs.length} docs in ${formatDuration(Date.now() - t0)}`)

  if (format === "json") { output(docs, format) } else {
    for (const d of docs) formatDocSummary(d as unknown as Record<string, unknown>)
    console.log(`\nTotal: ${docs.length} document(s)`)
  }
  return 0
}

const recentCmd: RunFn = async (ctx, positional, flags, boolFlags) => {
  const hours = parseInt(flags.hours || "24")
  const includeContent = boolFlags.has("with-content")
  const format = flags.output || "text"

  vlogStep(ctx, "Recent documents", `hours=${hours}, includeContent=${includeContent}`)
  const t0 = Date.now()
  const docs = listRecentDocs({ hours, limit: parseInt(flags.limit || "50"), include_content: includeContent })
  vlogStep(ctx, "Recent complete", `${docs.length} docs in ${formatDuration(Date.now() - t0)}`)

  if (format === "json") { output(docs, format) } else {
    for (const d of docs) {
      const id = d.meta.id
      const title = d.meta.title
      const time = new Date(d.meta.created_at!).toLocaleString()
      console.log(`\x1b[1m${id}\x1b[0m ${title} \x1b[90m(${time})\x1b[0m`)
      if (d.snippet) console.log(`  ${d.snippet.slice(0, 120)}`)
    }
    console.log(`\n${docs.length} recent document(s)`)
  }
  return 0
}

const readCmd: RunFn = async (ctx, positional, flags) => {
  const id = positional[0]
  if (!id) { console.error("Error: doc-id required"); return 1 }
  const format = flags.output || "text"

  vlogStep(ctx, "Read document", `id=${id}`)
  const t0 = Date.now()
  const result = readDoc(id, true)
  vlogStep(ctx, "Read complete", formatDuration(Date.now() - t0))

  if (!result) { console.error(`Document not found: ${id}`); return 1 }

  if (format === "json") {
    output({ meta: result.meta, content: result.content, truncated: result.truncated }, format)
  } else {
    formatDocFull(result.meta as unknown as Record<string, unknown>, result.content)
    if (result.truncated) console.log(`\n\x1b[90m[Content truncated]\x1b[0m`)
  }
  return 0
}

const writeCmd: RunFn = async (ctx, positional, flags) => {
  const title = positional[0]
  if (!title) { console.error("Error: title required"); return 1 }

  let content = positional[1]
  if (!content && !process.stdin.isTTY) {
    vlogStep(ctx, "Reading content from stdin...")
    content = await readStdin()
  }
  if (!content) { console.error("Error: content required (2nd arg or stdin)"); return 1 }

  const tags = flags.tags ? flags.tags.split(",") : []
  const keywords = flags.keywords ? flags.keywords.split(",") : []
  const intent = flags.intent || ""
  const projectDescription = flags["project-description"] || ""
  const sourceProject = flags["source-project"] || ""

  vlogStep(ctx, "Write document", `title="${title}", content=${content.length} chars`)
  const t0 = Date.now()
  const meta = writeDoc({
    title,
    tags,
    keywords,
    intent,
    project_description: projectDescription,
    source_project: sourceProject,
  }, content)
  vlogStep(ctx, "Write complete", `id=${meta.id} in ${formatDuration(Date.now() - t0)}`)

  console.log(`\x1b[32mWritten:\x1b[0m ${meta.id} - ${meta.title}`)
  console.log(`  File: ${meta.file_path}`)
  return 0
}

const deleteCmd: RunFn = async (ctx, positional) => {
  const id = positional[0]
  if (!id) { console.error("Error: doc-id required"); return 1 }

  vlogStep(ctx, "Delete document", `id=${id}`)
  const t0 = Date.now()
  const ok = deleteDoc(id)
  vlogStep(ctx, "Delete complete", formatDuration(Date.now() - t0))

  if (ok) {
    console.log(`\x1b[32mDeleted:\x1b[0m ${id}`)
  } else {
    console.error(`\x1b[31mNot found:\x1b[0m ${id}`)
    return 1
  }
  return 0
}

const ingestUrl: RunFn = async (ctx, positional, flags) => {
  const url = positional[0]
  const title = positional[1]
  if (!url) { console.error("Error: url required"); return 1 }
  if (!title) { console.error("Error: title required"); return 1 }

  vlogStep(ctx, "Fetch URL", url)
  const t0 = Date.now()

  const content = await fetchUrlContent(url)
  vlogStep(ctx, "Fetch complete", `${content.length} chars in ${formatDuration(Date.now() - t0)}`)

  if (!content) { console.error("Error: failed to fetch URL content"); return 1 }

  const tags = flags.tags ? flags.tags.split(",") : ["reference", "auto-ingested"]
  const keywords = flags.keywords ? flags.keywords.split(",") : extractKeywordsFromTitle(title)

  vlogStep(ctx, "Write to KB", `title="${title}"`)
  const writeStart = Date.now()
  const meta = writeDoc({ title, tags, keywords, intent: `Ingested from ${url}`, project_description: "Knowledge base" }, content)
  vlogStep(ctx, "Write complete", `id=${meta.id} in ${formatDuration(Date.now() - writeStart)}`)

  console.log(`\x1b[32mIngested:\x1b[0m ${meta.id} - ${meta.title}`)
  console.log(`  URL:  ${url}`)
  console.log(`  File: ${meta.file_path}`)
  return 0
}

const ingestRepo: RunFn = async (ctx, positional, flags) => {
  const repo = positional[0]
  if (!repo) { console.error("Error: repo (owner/name) required"); return 1 }
  const maxFiles = parseInt(flags["max-files"] || "20")

  vlogStep(ctx, "Ingest repo", `${repo}, maxFiles=${maxFiles}`)
  console.error("Repo ingestion requires git and network access. Use research command for web-based analysis.")
  return 1
}

const researchCmd: RunFn = async (ctx, positional, flags) => {
  const query = positional[0]
  if (!query) { console.error("Error: query required"); return 1 }
  const mode = (flags.mode || "standard") as "quick" | "standard" | "deep"

  vlogStep(ctx, "Research", `query="${query}", mode=${mode}`)
  const t0 = Date.now()

  try {
    const { ResearchAgent } = await import("../research/research-agent.js")
    const agent = new ResearchAgent(
      { query, mode },
      () => {},
    )
    vlogStep(ctx, "Research agent initialized")
    const result = await agent.run()
    vlogStep(ctx, "Research complete", formatDuration(Date.now() - t0))

    if (typeof result === "string") {
      console.log(result)
    } else {
      output(result, flags.output || "text")
    }
    return 0
  } catch (e) {
    console.error(`Research failed: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
}

const askCmd: RunFn = async (ctx, positional, flags) => {
  const query = positional[0]
  if (!query) { console.error("Error: query required"); return 1 }
  const maxWebResults = parseInt(flags["max-web-results"] || "3")
  const format = flags.output || "text"

  vlogStep(ctx, "Ask pipeline", `query="${query}"`)
  const t0 = Date.now()
  const result = await kbAskPipeline(query, maxWebResults)
  vlogStep(ctx, "Ask complete", `from_kb=${result.from_kb}, quality=${result.quality} in ${formatDuration(Date.now() - t0)}`)

  if (format === "json") {
    output(result, format)
  } else {
    if (result.from_kb && result.content) {
      console.log(`\x1b[32mFound in KB\x1b[0m (quality: ${result.quality}, loops: ${result.loops_used})`)
      console.log(`ID: ${result.id}`)
      console.log(`Title: ${result.title}`)
      console.log(`Score: ${result.score}`)
      console.log(`---`)
      console.log(result.content)
    } else {
      console.log(`\x1b[33mNot found in KB\x1b[0m`)
      console.log(`Hint: ${result.hint}`)
      if (result.suggested_workflow) {
        console.log(`\nSuggested workflow:`)
        console.log(`  1. ${result.suggested_workflow.step_1_search}`)
        console.log(`  2. ${result.suggested_workflow.step_2_read}`)
        console.log(`  3. ${result.suggested_workflow.step_3_store}`)
      }
    }
  }
  return result.from_kb ? 0 : 2
}

const outlineCmd: RunFn = async (ctx, positional, flags) => {
  const project = positional[0]
  if (!project) { console.error("Error: project path required"); return 1 }

  vlogStep(ctx, "Get outline", project)
  const outline = getOutline(project)
  if (!outline) { console.error(`No outline found for: ${project}`); return 1 }
  output(outline, flags.output || "json")
  return 0
}

const staleCmd: RunFn = async (ctx, positional, flags) => {
  vlogStep(ctx, "Stale check")
  const t0 = Date.now()
  const idx = readIndex()
  const stale: Array<{ id: string; title: string; reason: string }> = []
  const { existsSync, statSync } = await import("node:fs")

  for (const [id, meta] of Object.entries(idx.documents)) {
    const rec = meta as unknown as Record<string, unknown>
    const related = rec.related_files as string[] | undefined
    if (!related || related.length === 0) continue
    const updatedAt = (rec.updated_at as number) || (rec.created_at as number) || 0
    for (const f of related) {
      if (!existsSync(f)) {
        stale.push({ id, title: rec.title as string, reason: `file deleted: ${f}` })
      } else {
        const stat = statSync(f)
        if (stat.mtimeMs > updatedAt) {
          stale.push({ id, title: rec.title as string, reason: `file modified: ${f}` })
        }
      }
    }
  }
  vlogStep(ctx, "Stale check complete", `${stale.length} stale docs in ${formatDuration(Date.now() - t0)}`)

  if (flags.output === "json") { output(stale, "json") } else {
    if (stale.length === 0) { console.log("No stale documents."); return 0 }
    for (const s of stale) {
      console.log(`\x1b[33m${s.id}\x1b[0m ${s.title}`)
      console.log(`  ${s.reason}`)
    }
    console.log(`\n${stale.length} stale document(s)`)
  }
  return 0
}

const suggestCmd: RunFn = async (ctx, positional, flags) => {
  vlogStep(ctx, "Suggest topics")
  const stats = getMissStats()
  if (flags.output === "json") { output(stats, "json") } else {
    if (stats.top_missed.length === 0) { console.log("No suggestions. All queries resolved!"); return 0 }
    console.log("\x1b[1mTop missed queries:\x1b[0m")
    for (const m of stats.top_missed) {
      console.log(`  "${m.query}" (${m.count} misses)`)
    }
    console.log(`\nTotal unresolved: ${stats.unresolved.length}`)
  }
  return 0
}

const keywordsCmd: RunFn = async (ctx, positional, flags) => {
  const result = getAllKeywords()
  if (flags.output === "json") { output(result, "json") } else {
    console.log(`${result.count} keywords:`)
    console.log(result.keywords.join(", "))
  }
  return 0
}

const statsCmd: RunFn = async (ctx, positional, flags) => {
  vlogStep(ctx, "Compute stats")
  const idx = readIndex()
  const docs = Object.values(idx.documents)
  const tagCounts: Record<string, number> = {}
  let totalContentLength = 0
  for (const d of docs) {
    const meta = d as unknown as Record<string, unknown>
    const tags = (Array.isArray(meta.tags) ? meta.tags : []) as string[]
    for (const t of tags) tagCounts[t] = (tagCounts[t] || 0) + 1
    totalContentLength += (meta.content_length as number) || 0
  }
  const stats = {
    total_documents: docs.length,
    total_content_bytes: totalContentLength,
    tags: tagCounts,
  }
  if (flags.output === "json") { output(stats, "json") } else {
    console.log(`\x1b[1mKnowledge Base Statistics\x1b[0m`)
    console.log(`Documents: ${stats.total_documents}`)
    console.log(`Total content: ${(stats.total_content_bytes / 1024 / 1024).toFixed(2)} MB`)
    console.log(`\nTags:`)
    const sorted = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 20)
    for (const [tag, count] of sorted) {
      console.log(`  ${tag}: ${count}`)
    }
  }
  return 0
}

async function fetchUrlContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; kb-mcp-cli/1.0)" },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) return ""
    const html = await response.text()
    return stripHtml(html)
  } catch {
    return ""
  }
}

function stripHtml(html: string): string {
  let text = html
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "")
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "")
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, "")
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, "")
  text = text.replace(/<header[\s\S]*?<\/header>/gi, "")
  text = text.replace(/<[^>]+>/g, " ")
  text = text.replace(/&nbsp;/g, " ")
  text = text.replace(/&amp;/g, "&")
  text = text.replace(/&lt;/g, "<")
  text = text.replace(/&gt;/g, ">")
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#\d+;/g, "")
  text = text.replace(/\s+/g, " ")
  return text.trim()
}

function extractKeywordsFromTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .split(" ")
    .filter(w => w.length > 1)
    .slice(0, 8)
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf-8")
}

const commands: Record<string, RunFn> = {
  search: searchCombined,
  "search-token": searchToken,
  "search-tfidf": searchTfidf,
  "search-semantic": searchSemantic,
  list: listCmd,
  recent: recentCmd,
  read: readCmd,
  write: writeCmd,
  delete: deleteCmd,
  "ingest-url": ingestUrl,
  "ingest-repo": ingestRepo,
  research: researchCmd,
  ask: askCmd,
  outline: outlineCmd,
  stale: staleCmd,
  suggest: suggestCmd,
  keywords: keywordsCmd,
  stats: statsCmd,
}

export async function runCommand(
  command: string,
  ctx: CliContext,
  positional: string[],
  flags: Record<string, string>,
  boolFlags: Set<string>,
): Promise<number> {
  const fn = commands[command]
  if (!fn) {
    console.error(`Unknown command: ${command}`)
    console.error(`Run 'kb-mcp --help' for available commands.`)
    return 1
  }
  return fn(ctx, positional, flags, boolFlags)
}
