import { registerSource } from "./source-registry.js"
import { loadConfig } from "../config.js"

export function registerBuiltinSources(): void {
  const config = loadConfig()
  const sp = config.searchPipeline?.sources

  if (sp?.webSearchPrime?.enabled && config.webSearch.apiKey) {
    registerSource({
      name: "web-search-prime",
      tier: "fast",
      enabled: true,
      create: async () => {
        const { WebSearchPrimeSource } = await import("./source-web-search-prime.js")
        return new WebSearchPrimeSource()
      },
    })
  }

  if (sp?.xbrowser?.enabled) {
    registerSource({
      name: "xbrowser",
      tier: "medium",
      enabled: true,
      create: async () => {
        const { createXBrowserSources } = await import("./source-xbrowser.js")
        const engines = sp.xbrowser.engines?.length ? sp.xbrowser.engines : [sp.xbrowser.engine]
        const sources = createXBrowserSources(
          {
            enabled: true,
            engine: sp.xbrowser.engine,
            cdpEndpoint: sp.xbrowser.cdpEndpoint,
            headless: sp.xbrowser.headless,
            timeout: sp.xbrowser.timeout,
          },
          engines,
        )
        return sources[0] || null
      },
    })
  }

  if (sp?.tavily?.enabled && config.webSearch.tavilyApiKey) {
    registerSource({
      name: "tavily",
      tier: "fast",
      enabled: true,
      create: async () => {
        const { TavilySource } = await import("./source-tavily.js")
        return new TavilySource()
      },
    })
  }

  if (sp?.serper?.enabled && config.webSearch.serperApiKey) {
    registerSource({
      name: "serper",
      tier: "fast",
      enabled: true,
      create: async () => {
        const { SerperSource } = await import("./source-serper.js")
        return new SerperSource()
      },
    })
  }

  if (sp?.aiSearch?.enabled) {
    registerSource({
      name: "ai-search",
      tier: "slow",
      enabled: true,
      create: async () => {
        const { AiSearchSource } = await import("./source-ai-search.js")
        return new AiSearchSource()
      },
    })
  }

  if (sp?.llmDirect?.enabled) {
    registerSource({
      name: "llm-direct",
      tier: "fast",
      enabled: true,
      create: async () => {
        const { LlmDirectSource } = await import("./source-llm-direct.js")
        return new LlmDirectSource()
      },
    })
  }
}
