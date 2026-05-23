/**
 * Shared JSON extraction utility for LLM responses.
 * Handles code fences, surrounding text, brace-matching fallbacks,
 * trailing commas, single quotes, and other common LLM output issues.
 */

import { createLogger } from "../../utils/logger.js"
const logger = createLogger("research:json-parser")

function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?\n?/g, "").replace(/```\n?/g, "").trim()
}

function tryFixJson(candidate: string): string | null {
  let fixed = candidate
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,\s*$/gm, "")
  try {
    JSON.parse(fixed)
    return fixed
  } catch { /* next */ }

  fixed = fixed.replace(/'([^']*)'\s*:/g, '"$1":')
  try {
    JSON.parse(fixed)
    return fixed
  } catch { /* next */ }

  fixed = fixed.replace(/:\s*'([^']*)'/g, ': "$1"')
  try {
    JSON.parse(fixed)
    return fixed
  } catch { /* next */ }

  return null
}

function findMatchingBrace(text: string, openChar: string, closeChar: string): string | null {
  let depth = 0
  let start = -1
  let lastValid: string | null = null
  const candidates: string[] = []

  for (let i = 0; i < text.length; i++) {
    if (text[i] === openChar) {
      if (depth === 0) start = i
      depth++
    } else if (text[i] === closeChar) {
      depth--
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, i + 1))
      }
    }
  }

  for (let ci = candidates.length - 1; ci >= 0; ci--) {
    const candidate = candidates[ci]
    try {
      JSON.parse(candidate)
      return candidate
    } catch { /* try fix */ }
    const fixed = tryFixJson(candidate)
    if (fixed) {
      try {
        JSON.parse(fixed)
        return fixed
      } catch { /* next */ }
    }
  }

  return lastValid
}

/** Extract a JSON object from text that may contain extra content around it */
export function extractJsonObject(text: string): string | null {
  if (!text || !text.trim()) return null

  const cleaned = stripCodeFences(text)

  try {
    JSON.parse(cleaned)
    return cleaned
  } catch { /* next */ }

  const fixedDirect = tryFixJson(cleaned)
  if (fixedDirect) return fixedDirect

  return findMatchingBrace(cleaned, "{", "}")
}

/** Extract a JSON array from text that may contain extra content around it */
export function extractJsonArray(text: string): string | null {
  if (!text || !text.trim()) return null

  const cleaned = stripCodeFences(text)

  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) return cleaned
  } catch { /* next */ }

  const fixedDirect = tryFixJson(cleaned)
  if (fixedDirect) {
    try {
      if (Array.isArray(JSON.parse(fixedDirect))) return fixedDirect
    } catch { /* next */ }
  }

  let depth = 0
  let start = -1
  const candidates: string[] = []
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "[") {
      if (depth === 0) start = i
      depth++
    } else if (cleaned[i] === "]") {
      depth--
      if (depth === 0 && start >= 0) {
        candidates.push(cleaned.slice(start, i + 1))
      }
    }
  }

  for (let ci = candidates.length - 1; ci >= 0; ci--) {
    const candidate = candidates[ci]
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) return candidate
    } catch { /* try fix */ }
    const fixed = tryFixJson(candidate)
    if (fixed) {
      try {
        const parsed = JSON.parse(fixed)
        if (Array.isArray(parsed)) return fixed
      } catch { /* next */ }
    }
  }

  return null
}
