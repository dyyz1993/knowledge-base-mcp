import type { IncomingMessage, ServerResponse } from "node:http"
import { json } from "../http.js"
import * as session from "../chat/session"
import { readSession, listSessions } from "../chat/store-sessions"
import type { ChatMessage } from "../chat/store-sessions"

function formatMessagesAsMarkdown(messages: ChatMessage[], sessionName?: string): string {
  const date = new Date().toISOString().split("T")[0]
  const lines: string[] = []
  lines.push("# Chat History Export")
  if (sessionName) lines.push(`Session: ${sessionName}`)
  lines.push(`Date: ${date}`)
  lines.push("")

  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push("## User")
      lines.push(msg.content)
      lines.push("")
    } else if (msg.role === "assistant") {
      lines.push("## Assistant")
      lines.push(msg.content)
      lines.push("")
      lines.push("---")
      lines.push("")
    }
  }

  return lines.join("\n")
}

export async function handleChatExport(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== "GET") {
    json(res, { error: "Method not allowed" }, 405)
    return
  }

  const format = url.searchParams.get("format") || "markdown"
  if (format !== "markdown") {
    json(res, { error: "Unsupported format. Use 'markdown'." }, 400)
    return
  }

  const pathParts = url.pathname.replace(/^\/+|\/+$/g, "").split("/")
  const sessionId = pathParts[3]

  if (sessionId) {
    const meta = readSession(sessionId)
    if (!meta) {
      json(res, { error: "Session not found" }, 404)
      return
    }
    const messages = session.getMessages(sessionId)
    if (messages.length === 0) {
      json(res, { error: "No messages in session" }, 404)
      return
    }
    const md = formatMessagesAsMarkdown(messages, meta.name)
    res.writeHead(200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="chat-${sessionId}.md"`,
    })
    res.end(md)
    return
  }

  const sessions = listSessions()
  const allMessages: Array<{ sessionName: string; messages: ChatMessage[] }> = []
  for (const s of sessions) {
    const msgs = session.getMessages(s.id)
    if (msgs.length > 0) {
      allMessages.push({ sessionName: s.name, messages: msgs })
    }
  }

  if (allMessages.length === 0) {
    json(res, { error: "No chat messages found" }, 404)
    return
  }

  const parts: string[] = []
  for (const { sessionName, messages } of allMessages) {
    parts.push(formatMessagesAsMarkdown(messages, sessionName))
  }

  const md = parts.join("\n\n---\n\n")
  res.writeHead(200, {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="chat-export-${new Date().toISOString().split("T")[0]}.md"`,
  })
  res.end(md)
}
