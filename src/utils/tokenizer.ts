export interface TokenizeOptions {
  lowercase?: boolean
  removeStopWords?: boolean
  minTokenLength?: number
  bigram?: boolean
  splitChars?: string
}

const STOP_WORDS = new Set([
  "的", "了", "是", "在", "我", "你", "他", "她", "它", "们",
  "这", "那", "个", "什", "么", "怎", "如何", "哪", "几", "多",
  "能", "会", "要", "想", "帮", "给", "请", "让", "被", "把",
  "和", "与", "或", "但", "而", "也", "就", "都", "很", "非常",
  "一", "二", "三", "不", "没", "有", "用", "做", "来", "去",
  "上", "下", "前", "后", "里", "外", "中", "好", "对", "可以",
  "需要", "知道", "告诉", "说说", "介绍", "说明", "描述", "关于",
  "问题", "方法", "方式", "比如", "例如", "包括", "以及", "等等",
  "搞", "一个", "想要", "帮我", "怎么",
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "dare", "ought",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "and", "but", "or", "nor", "so", "yet", "both", "either", "neither",
  "not", "only", "own", "same", "than", "too", "very", "just",
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  "am", "how", "why", "where", "when", "if", "then", "there", "here",
])

export function tokenize(text: string, options?: TokenizeOptions): string[] {
  const {
    lowercase = true,
    removeStopWords = false,
    minTokenLength = 1,
    bigram = false,
    splitChars = "",
  } = options || {}

  let input = text
  if (lowercase) input = input.toLowerCase()

  if (splitChars) {
    const escaped = splitChars.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    input = input.replace(new RegExp(`[${escaped}]`, "g"), " ")
  }

  const tokens: string[] = []

  if (bigram) {
    const cjkSegments = input.match(/[\u4e00-\u9fff]+/g) || []
    for (const seg of cjkSegments) {
      for (let i = 0; i < seg.length - 1; i++) {
        tokens.push(seg[i] + seg[i + 1])
      }
    }
    const words = input.match(/[a-z0-9]+/g) || []
    tokens.push(...words)
  } else {
    const segments = input.match(/([a-zA-Z0-9_.\-]+|[\u4e00-\u9fff]+)/g)
    if (segments) tokens.push(...segments)
  }

  return tokens.filter(t => {
    if (t.length < minTokenLength) return false
    if (removeStopWords && STOP_WORDS.has(t)) return false
    return true
  })
}

export { STOP_WORDS }
