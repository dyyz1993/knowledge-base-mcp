import type { SearchSource, SearchResult } from "./types"

export class PluginSource implements SearchSource {
  name = "plugin" as const
  private pluginPrompt: string
  private pluginHandler: ((query: string) => Promise<SearchResult[]>) | null = null

  constructor(pluginPrompt: string) {
    this.pluginPrompt = pluginPrompt
  }

  setHandler(handler: (query: string) => Promise<SearchResult[]>): void {
    this.pluginHandler = handler
  }

  available(): boolean {
    return !!this.pluginHandler
  }

  async search(query: string): Promise<SearchResult[]> {
    if (!this.pluginHandler) return []
    return this.pluginHandler(query)
  }

  getPrompt(): string {
    return this.pluginPrompt
  }
}
