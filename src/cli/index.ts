#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { initDb, closeDb } from "../search/vector-store.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("cli")

let _version = "0.0.0"
try {
  _version = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "package.json"), "utf-8")).version
} catch {}
const VERSION = _version

export interface CliContext {
  verbose: boolean
  args: string[]
}

export function vlog(ctx: CliContext, ...msgs: unknown[]) {
  if (!ctx.verbose) return
  const timestamp = new Date().toISOString().slice(11, 23)
  for (const msg of msgs) {
    if (typeof msg === "string") {
      for (const line of msg.split("\n")) {
        console.error(`\x1b[90m[${timestamp}] [verbose]\x1b[0m ${line}`)
      }
    } else {
      console.error(`\x1b[90m[${timestamp}] [verbose]\x1b[0m`, msg)
    }
  }
}

export function vlogStep(ctx: CliContext, step: string, detail?: string) {
  if (!ctx.verbose) return
  const icon = "\u25b6"
  console.error(`\x1b[36m  ${icon} ${step}\x1b[0m${detail ? ` \x1b[90m${detail}\x1b[0m` : ""}`)
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function printHelp() {
  console.log(`@dyyz1993/kb-mcp CLI v${VERSION}

Usage: kb-mcp <command> [options] [args]

Commands:
  search <query>              Search knowledge base (combined multi-strategy)
  search-token <query>        Token-based search
  search-tfidf <query>        TF-IDF search
  search-semantic <query>     Semantic vector search
  list [--tag <tag>] [--project <path>]
                              List documents
  recent [--hours <n>] [--with-content]
                              List recent documents
  read <doc-id>               Read a document
  write <title> [content]     Write a document (content from arg or stdin)
  delete <doc-id>             Delete a document
  ingest-url <url> <title>    Fetch URL and ingest into KB
  ingest-repo <owner/repo>    Clone & analyze a GitHub repo
  research <query>            Deep research a topic
  ask <query>                 Intelligent ask pipeline (multi-round)
  outline <project-path>      Show project outline
  stale                       Check for stale documents
  suggest                     Suggest topics to pre-fetch
  keywords                    List all keywords
  stats                       Show KB statistics
  version                     Show version

Global Options:
  --verbose, -v               Show detailed step-by-step process
  --limit <n>                 Limit results (default: 10)
  --tag <tag>                 Filter by tag
  --project <path>            Filter by project path
  --keywords <k1,k2,...>      Filter by keywords
  --output <format>           Output format: json | text (default: text)
  --help, -h                  Show help`)
}

function parseArgs(argv: string[]): { command: string; positional: string[]; flags: Record<string, string>; boolFlags: Set<string> } {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  const boolFlags = new Set<string>()
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === "--help" || arg === "-h") {
      boolFlags.add("help")
    } else if (arg === "--verbose" || arg === "-v") {
      boolFlags.add("verbose")
    } else if (arg === "--with-content") {
      boolFlags.add("with-content")
    } else if ((arg === "--limit" || arg === "--tag" || arg === "--project" || arg === "--keywords" || arg === "--output" || arg === "--mode" || arg === "--hours" || arg === "--max-files") && i + 1 < argv.length) {
      flags[arg.slice(2)] = argv[++i]
    } else if (arg.startsWith("--")) {
      boolFlags.add(arg.slice(2))
    } else {
      positional.push(arg)
    }
    i++
  }
  const command = positional.shift() || ""
  return { command, positional, flags, boolFlags }
}

export { parseArgs, printHelp, VERSION }

async function main() {
  const { command, positional, flags, boolFlags } = parseArgs(process.argv.slice(2))
  const verbose = boolFlags.has("verbose")
  const ctx: CliContext = { verbose, args: positional }

  if (boolFlags.has("help") || !command) {
    printHelp()
    process.exit(0)
  }

  if (command === "version") {
    console.log(`@dyyz1993/kb-mcp v${VERSION}`)
    process.exit(0)
  }

  vlog(ctx, `Initializing knowledge base...`)
  const startTime = Date.now()
  initDb()
  vlogStep(ctx, "Database initialized", formatDuration(Date.now() - startTime))

  try {
    const { runCommand } = await import("./commands.js")
    const exitCode = await runCommand(command, ctx, positional, flags, boolFlags)
    process.exit(exitCode)
  } catch (e) {
    console.error(`\x1b[31mError: ${e instanceof Error ? e.message : String(e)}\x1b[0m`)
    if (verbose && e instanceof Error && e.stack) {
      console.error(`\x1b[90m${e.stack}\x1b[0m`)
    }
    process.exit(1)
  } finally {
    closeDb()
  }
}

main()
