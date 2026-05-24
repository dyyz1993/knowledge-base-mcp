import { IncomingMessage, ServerResponse } from "node:http"
import { json } from "./helpers.js"
import { handleDocsRoutes } from "./api-docs.js"
import { handleSearchRoutes } from "./api-search.js"
import { handleResearchRoutes } from "./api-research.js"
import { handleAskResearchRoute } from "./api-ask-research.js"
import { handleConfigRoutes } from "./api-config.js"
import { handleCodegraphRoutes } from "./api-codegraph.js"

export async function handleRestAPI(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (await handleDocsRoutes(req, res, url)) return
  if (await handleSearchRoutes(req, res, url)) return
  if (await handleResearchRoutes(req, res, url)) return
  if (await handleAskResearchRoute(req, res, url)) return
  if (await handleCodegraphRoutes(req, res, url)) return
  if (await handleConfigRoutes(req, res, url)) return
  json(res, { error: "Not Found" }, 404)
}
