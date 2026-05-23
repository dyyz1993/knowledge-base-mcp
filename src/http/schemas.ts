import { z } from "zod"

const stringLimit = (min: number, max: number) => z.string().min(min).max(max)

export const getDocByIdSchema = z.object({
  id: stringLimit(1, 200),
})

export const recentDocsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(8760).optional().default(24),
  since: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  include_content: z.preprocess(
    v => v === "true",
    z.boolean().optional().default(false),
  ),
  format: z.enum(["json", "html"]).optional().default("json"),
})

export const readDocByIdSchema = z.object({
  id: stringLimit(1, 200),
})

export const outlineQuerySchema = z.object({
  project: stringLimit(1, 500),
})

export const writeDocSchema = z.object({
  title: stringLimit(1, 500),
  content: stringLimit(1, 500000),
  tags: z.array(stringLimit(1, 100)).max(20).optional().default([]),
  keywords: z.array(stringLimit(1, 100)).max(30).optional().default([]),
  intent: stringLimit(0, 500).optional().default(""),
  project_description: stringLimit(0, 500).optional().default(""),
  source_project: stringLimit(0, 500).optional().default(""),
  source_worktree: stringLimit(0, 500).optional().default(""),
  project_path: stringLimit(0, 500).optional().default(""),
  related_projects: z.array(stringLimit(1, 200)).max(20).optional().default([]),
  related_files: z.array(stringLimit(1, 500)).max(50).optional().default([]),
})

export const semanticSearchSchema = z.object({
  query: stringLimit(1, 2000),
  limit: z.number().int().min(1).max(100).optional().default(10),
})

export const searchSchema = z.object({
  query: stringLimit(0, 2000).optional(),
  keywords: z.array(stringLimit(1, 200)).max(20).optional(),
  tags: z.array(stringLimit(1, 100)).max(20).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const kbAskSchema = z.object({
  query: stringLimit(1, 2000),
  max_web_results: z.number().int().min(1).max(20).optional().default(3),
})

export const askSearchSchema = z.object({
  query: stringLimit(1, 2000),
  model: z.object({
    provider: stringLimit(1, 100),
    id: stringLimit(1, 200),
  }).optional(),
})

export const webReadSchema = z.object({
  url: stringLimit(1, 2048),
})

export const kbIngestSchema = z.object({
  url: stringLimit(0, 2048).optional(),
  title: stringLimit(1, 500),
  content: stringLimit(1, 500000),
  tags: z.array(stringLimit(1, 100)).max(20).optional(),
  keywords: z.array(stringLimit(1, 100)).max(30).optional(),
})

export const deepReadSchema = z.object({
  url: stringLimit(1, 2048),
})

export const summarizeSchema = z.object({
  query: stringLimit(0, 2000).optional(),
  content: stringLimit(1, 500000),
  title: stringLimit(1, 500),
  url: stringLimit(0, 2048).optional(),
  tags: z.array(stringLimit(1, 100)).max(20).optional(),
  keywords: z.array(stringLimit(1, 100)).max(30).optional(),
})

const searchResultItemSchema = z.object({
  title: stringLimit(1, 500),
  snippet: stringLimit(0, 10000).optional().default(""),
  url: stringLimit(0, 2048).optional().default(""),
  sourceType: stringLimit(0, 100).optional().default(""),
  source: stringLimit(0, 200).optional().default(""),
  qualityScore: z.number().min(0).max(1).optional().default(0),
})

export const workKeySchema = z.object({
  query: stringLimit(1, 2000),
  results: z.array(searchResultItemSchema).min(1).max(50),
  model: z.object({
    provider: stringLimit(1, 100),
    id: stringLimit(1, 200),
  }).optional(),
})

const modelSpecSchema = z.object({
  provider: stringLimit(1, 100),
  id: stringLimit(1, 200),
})

export const agentResearchSchema = z.object({
  query: stringLimit(1, 2000),
  mode: z.enum(["quick", "standard", "deep"]).optional().default("standard"),
  model: modelSpecSchema.optional(),
  smallModel: modelSpecSchema.optional(),
})

const evolveTargetMetricsSchema = z.object({
  minAvgQuality: z.number().min(0).max(1),
  minAvgCoverage: z.number().min(0).max(1),
  minDRSuccessRate: z.number().min(0).max(1),
  maxZeroDRRate: z.number().min(0).max(1),
})

export const researchEvolveSchema = z.object({
  maxCycles: z.number().int().min(1).max(20).optional().default(3),
  serverUrl: stringLimit(1, 500).optional(),
  model: modelSpecSchema.optional(),
  smallModel: modelSpecSchema.optional(),
  targetMetrics: evolveTargetMetricsSchema.optional(),
})

export const ingestSiteSchema = z.object({
  url: stringLimit(1, 2048),
  maxPages: z.union([z.string(), z.number()]).optional().transform(v => {
    const n = typeof v === "string" ? parseInt(v, 10) : v
    return Math.min(Math.max(n || 10, 1), 100)
  }),
  concurrency: z.union([z.string(), z.number()]).optional().transform(v => {
    const n = typeof v === "string" ? parseInt(v, 10) : v
    return Math.min(Math.max(n || 2, 1), 10)
  }),
  tags: z.array(stringLimit(1, 100)).max(20).optional().default([]),
  projectName: stringLimit(0, 200).optional(),
})

export const askResearchSchema = z.object({
  query: stringLimit(1, 2000),
  model: z.object({
    provider: stringLimit(1, 100),
    id: stringLimit(1, 200),
  }).optional(),
})

export const statsResetSchema = z.object({
  type: z.enum(["search", "llm", "embedding", "mcp", "all"]).optional().default("all"),
})
