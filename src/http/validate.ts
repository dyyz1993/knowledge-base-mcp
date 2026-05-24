import { z, ZodSchema, ZodError, ZodType } from "zod"
import type { IncomingMessage, ServerResponse } from "node:http"
import { json, parseBody } from "./helpers.js"

export function validateBody<T>(schema: ZodSchema<T>, body: unknown): T {
  return schema.parse(body)
}

export function formatZodError(error: ZodError): string {
  return error.issues.map(e => `${e.path.join(".")}: ${e.message}`).join("; ")
}

export function handleValidationError(e: unknown, res: ServerResponse): boolean {
  if (e instanceof ZodError) {
    json(res, { error: formatZodError(e) }, 400)
    return true
  }
  return false
}

export async function parseBodyTyped<T extends ZodType>(
  req: IncomingMessage,
  res: ServerResponse,
  schema: T,
): Promise<z.infer<T> | null> {
  const body = await parseBody(req, res)
  if (body === null) return null
  const result = schema.safeParse(body)
  if (!result.success) {
    json(res, { error: formatZodError(result.error) }, 400)
    return null
  }
  return result.data
}
