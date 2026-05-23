export const HIGH_RELEVANCE_SCORE = 70
export const LOW_RELEVANCE_SCORE = 60
export const MIN_SUMMARY_LENGTH = 200
export const MIN_RESULTS_FOR_COMPLETE = 7
export const EARLY_STOP_THRESHOLD = 10
export const MAX_SEARCH_LIMIT = 500
export const MIN_CONTENT_LENGTH = 300
export const MIN_SHORT_CONTENT_LENGTH = 100

export const RRF_K = 60

export const SEARCH_WEIGHTS = {
  token: 0.3,
  tfidf: 0.3,
  semantic: 0.4,
} as const
