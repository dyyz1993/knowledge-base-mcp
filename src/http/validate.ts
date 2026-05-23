import { ZodSchema, ZodError } from "zod"
import type { ServerResponse } from "node:http"
import { json } from "./helpers.js"

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
