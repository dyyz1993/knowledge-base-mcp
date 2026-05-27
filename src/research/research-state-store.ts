import type { ResearchResult, ResearchProgress } from "./types.js"

export interface ResearchState {
  researchId: string
  query: string
  mode: string
  status: "running" | "completed" | "failed"
  progress: ResearchProgress[]
  result?: ResearchResult
  error?: string
  createdAt: number
  updatedAt: number
}

const store = new Map<string, ResearchState>()
const MAX_AGE_MS = 60 * 60 * 1000

export function createResearchState(researchId: string, query: string, mode: string): ResearchState {
  const state: ResearchState = {
    researchId,
    query,
    mode,
    status: "running",
    progress: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  store.set(researchId, state)
  return state
}

export function getResearchState(researchId: string): ResearchState | undefined {
  return store.get(researchId)
}

export function updateResearchProgress(researchId: string, progress: ResearchProgress): void {
  const state = store.get(researchId)
  if (!state) return
  state.progress.push(progress)
  state.updatedAt = Date.now()
}

export function completeResearch(researchId: string, result: ResearchResult): void {
  const state = store.get(researchId)
  if (!state) return
  state.status = "completed"
  state.result = result
  state.updatedAt = Date.now()
}

export function failResearch(researchId: string, error: string): void {
  const state = store.get(researchId)
  if (!state) return
  state.status = "failed"
  state.error = error
  state.updatedAt = Date.now()
}

export function cleanupOldResearch(): void {
  const now = Date.now()
  for (const [id, state] of store) {
    if (now - state.updatedAt > MAX_AGE_MS) {
      store.delete(id)
    }
  }
}

const cleanupTimer = setInterval(cleanupOldResearch, 5 * 60 * 1000)
cleanupTimer.unref?.()
