const MAX_PATTERN_LENGTH = 500

const DANGEROUS_PATTERNS = [
  /(\([^)]*[+*][^)]*\))[+*]/,
  /(\[[^\]]*[+*][^\]]*\])[+*]/,
  /(\([^)]*\|[^)]*\))+/,
  /\([^)]{20,}\)/,
]

export function validateRegexPattern(pattern: string): { safe: boolean; reason?: string } {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { safe: false, reason: `Pattern too long (max ${MAX_PATTERN_LENGTH} chars)` }
  }

  for (const dangerous of DANGEROUS_PATTERNS) {
    if (dangerous.test(pattern)) {
      return { safe: false, reason: "Pattern contains potentially dangerous nested quantifiers" }
    }
  }

  return { safe: true }
}

const MAX_TEXT_LENGTH = 1_000_000

export function safeRegexExec(
  regex: RegExp,
  text: string,
): RegExpExecArray | null {
  const validation = validateRegexPattern(regex.source)
  if (!validation.safe) {
    throw new Error(`Unsafe regex: ${validation.reason}`)
  }

  const searchText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
  return regex.exec(searchText)
}

export function safeRegexTest(
  regex: RegExp,
  text: string,
): boolean {
  const validation = validateRegexPattern(regex.source)
  if (!validation.safe) {
    throw new Error(`Unsafe regex: ${validation.reason}`)
  }

  const searchText = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text
  return regex.test(searchText)
}
