import type { IncomingMessage, ServerResponse } from "node:http"
import { getProviders, getModels } from "@dyyz1993/pi-ai"
import * as session from "./session"
import { json, readBody } from "../http.js"

export async function handleGetModels(_req: IncomingMessage, res: ServerResponse) {
  const providers = getProviders()
  const models = providers.flatMap(p =>
    getModels(p as never).map(m => ({ provider: m.provider, id: m.id, name: m.name }))
  )
  json(res, { models, current: null })
}

export async function handleSetModel(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req))
  const { sessionId, provider, id } = body as { sessionId: string; provider: string; id: string }
  if (!sessionId || !provider || !id) {
    json(res, { error: "sessionId, provider, and id are required" }, 400)
    return
  }
  session.setModel(sessionId, { provider, id })
  json(res, { ok: true, model: { provider, id } })
}
