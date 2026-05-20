/**
 * Shared JSON extraction utility for LLM responses.
 * Handles code fences, surrounding text, and brace-matching fallbacks.
 */

/** Extract a JSON object from text that may contain extra content around it */
export function extractJsonObject(text: string): string | null {
  if (!text || !text.trim()) return null
  // Try direct parse after stripping code fences
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  try {
    JSON.parse(cleaned)
    return cleaned
  } catch {}
  // Brace-matching fallback: find outermost valid JSON object
  let depth = 0
  let start = -1
  let lastValid: string | null = null
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "{") {
      if (depth === 0) start = i
      depth++
    } else if (cleaned[i] === "}") {
      depth--
      if (depth === 0 && start >= 0) {
        const candidate = cleaned.slice(start, i + 1)
        try {
          JSON.parse(candidate)
          lastValid = candidate
        } catch {}
      }
    }
  }
  return lastValid
}

/** Extract a JSON array from text that may contain extra content around it */
export function extractJsonArray(text: string): string | null {
  if (!text || !text.trim()) return null
  const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) return cleaned
  } catch {}
  // Bracket-matching fallback
  let depth = 0
  let start = -1
  let lastValid: string | null = null
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned[i] === "[") {
      if (depth === 0) start = i
      depth++
    } else if (cleaned[i] === "]") {
      depth--
      if (depth === 0 && start >= 0) {
        const candidate = cleaned.slice(start, i + 1)
        try {
          const parsed = JSON.parse(candidate)
          if (Array.isArray(parsed)) lastValid = candidate
        } catch {}
      }
    }
  }
  return lastValid
}
