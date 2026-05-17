export type ResearchMode = "quick" | "standard" | "deep"

export type StepName =
  | "analyze_query"
  | "search"
  | "filter_results"
  | "evaluate"
  | "deep_read"
  | "check_sitemap"
  | "follow_paths"
  | "evaluate_depth"
  | "check_github"
  | "clone_index"
  | "code_search"
  | "synthesize"

export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed"

export type StepDecision = "done" | "need_sitemap" | "need_github" | "need_more_search" | "continue"

export interface StepCost {
  model: "small" | "large" | "none"
  cost: number
}

export const STEP_COSTS: Record<StepName, StepCost> = {
  analyze_query: { model: "small", cost: 1 },
  search: { model: "none", cost: 1 },
  filter_results: { model: "small", cost: 1 },
  evaluate: { model: "large", cost: 2 },
  deep_read: { model: "none", cost: 1 },
  check_sitemap: { model: "small", cost: 1 },
  follow_paths: { model: "none", cost: 1 },
  evaluate_depth: { model: "large", cost: 2 },
  check_github: { model: "small", cost: 1 },
  clone_index: { model: "none", cost: 2 },
  code_search: { model: "small", cost: 1 },
  synthesize: { model: "large", cost: 3 },
}

export const MODE_BUDGETS: Record<ResearchMode, { maxSteps: number; maxCost: number }> = {
  quick: { maxSteps: 7, maxCost: 12 },
  standard: { maxSteps: 16, maxCost: 30 },
  deep: { maxSteps: 25, maxCost: 40 },
}

export const QUICK_FLOW: StepName[] = ["analyze_query", "search", "filter_results", "evaluate", "deep_read", "synthesize"]
export const STANDARD_FLOW: StepName[] = [
  "analyze_query", "search", "filter_results", "evaluate",
  "deep_read", "evaluate_depth",
  "check_sitemap", "evaluate_depth",
  "check_github",
  "synthesize",
]
export const DEEP_FLOW: StepName[] = [
  "analyze_query", "search", "filter_results", "evaluate",
  "deep_read", "evaluate_depth",
  "check_sitemap", "evaluate_depth",
  "check_github",
  "synthesize",
]

export interface AnalyzeQueryResult {
  coreKeywords: string[]
  subQueries: string[]
  researchType: "doc" | "api" | "code" | "concept" | "comparison"
  language: "zh" | "en" | "mixed"
}

export interface FilterResult {
  index: number
  relevanceScore: number
  reason: string
}

export interface EvaluateResult {
  selectedIndices: number[]
  outline: string
  sitemapHints: string[]
  githubHints: string[]
  initialAssessment: string
}

export interface DepthEvaluation {
  qualityScore: number
  coverageScore: number
  decision: StepDecision
  reason: string
  nextTargets: string[]
  updatedOutline: string
  missingTopics: string[]
}

export interface SitemapCheck {
  isDocSite: boolean
  sitemapUrl: string | null
  relevantPaths: string[]
  priority: string[]
}

export interface GitHubCheck {
  repoUrl: string | null
  needsClone: boolean
  targetPaths: string[]
  searchKeywords: string[]
}

export interface DeepReadItem {
  title: string
  url: string
  content: string
  success: boolean
  source: string
}

export interface ResearchProgress {
  step: StepName
  status: StepStatus
  budget: { used: number; max: number; usedCost: number; maxCost: number }
  output?: unknown
  timestamp: number
}

export interface ResearchResult {
  query: string
  mode: ResearchMode
  summary: string
  summaryFallback: boolean
  outline: string
  sources: Array<{ title: string; url: string }>
  searchResults: Array<{
    title: string
    url: string
    snippet: string
    source: string
    sourceType: string
    qualityScore: number
  }>
  deepReadResults: DeepReadItem[]
  progressLog: ResearchProgress[]
  phaseLog: string[]
  durationMs: number
  totalSteps: number
  finalQualityScore: number
  finalCoverageScore: number
}

export interface ModelTier {
  small: { baseUrl: string; apiKey: string; model: string }
  large: { baseUrl: string; apiKey: string; model: string }
}

export interface ResearchRequest {
  query: string
  mode?: ResearchMode
  model?: { provider: string; id: string }
  smallModel?: { provider: string; id: string }
}
