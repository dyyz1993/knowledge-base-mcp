import { create } from "zustand"
import type { DocMeta } from "../services/api"
import { fetchDocs, fetchDoc, searchDocs } from "../services/api"

interface DocState {
  docs: DocMeta[]
  current: { meta: DocMeta; content: string; truncated: boolean } | null
  searchResults: (DocMeta & { score?: number })[]
  loading: boolean
  searching: boolean
  searchQuery: string
  load: () => Promise<void>
  select: (id: string) => Promise<void>
  search: (query: string) => Promise<void>
  setSearchQuery: (q: string) => void
}

export const useDocStore = create<DocState>((set) => ({
  docs: [],
  current: null,
  searchResults: [],
  loading: false,
  searching: false,
  searchQuery: "",

  load: async () => {
    set({ loading: true })
    try {
      const docs = await fetchDocs()
      set({ docs, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  select: async (id) => {
    set({ loading: true })
    try {
      const doc = await fetchDoc(id)
      set({ current: doc, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  search: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [], searchQuery: query, searching: false })
      return
    }
    set({ searching: true })
    try {
      const results = await searchDocs(query)
      set({ searchResults: results, searchQuery: query })
    } catch {
      set({ searchResults: [], searchQuery: query })
    } finally {
      set({ searching: false })
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
}))
