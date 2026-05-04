import { create } from "zustand"
import type { DocMeta } from "../services/api"
import { fetchDocs, fetchDoc, searchDocs } from "../services/api"

interface DocState {
  docs: DocMeta[]
  current: { meta: DocMeta; content: string; truncated: boolean } | null
  searchResults: (DocMeta & { score: number })[]
  loading: boolean
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
  searchQuery: "",

  load: async () => {
    set({ loading: true })
    const docs = await fetchDocs()
    set({ docs, loading: false })
  },

  select: async (id) => {
    set({ loading: true })
    const doc = await fetchDoc(id)
    set({ current: doc, loading: false })
  },

  search: async (query) => {
    if (!query.trim()) {
      set({ searchResults: [], searchQuery: query })
      return
    }
    const res = await searchDocs(query)
    set({ searchResults: res.documents || [], searchQuery: query })
  },

  setSearchQuery: (q) => set({ searchQuery: q }),
}))
