import type { SearchSource } from "./types.js"
import { createLogger } from "../utils/logger.js"

const logger = createLogger("search:source-registry")

export interface SourceDescriptor {
  name: string
  create: () => Promise<SearchSource | null>
  tier: "fast" | "medium" | "slow"
  enabled: boolean
}

const registry = new Map<string, SourceDescriptor>()

export function registerSource(descriptor: SourceDescriptor): void {
  registry.set(descriptor.name, descriptor)
  logger.debug(`Registered search source: ${descriptor.name} (${descriptor.tier})`)
}

export function unregisterSource(name: string): boolean {
  return registry.delete(name)
}

export function getSource(name: string): SourceDescriptor | undefined {
  return registry.get(name)
}

export function getAllSources(): SourceDescriptor[] {
  return Array.from(registry.values())
}

export async function createEnabledSources(): Promise<SearchSource[]> {
  const sources: SearchSource[] = []
  for (const desc of registry.values()) {
    if (!desc.enabled) continue
    try {
      const source = await desc.create()
      if (source) sources.push(source)
    } catch (e) {
      logger.warn(`Failed to create source ${desc.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return sources
}

export function setSourceEnabled(name: string, enabled: boolean): boolean {
  const desc = registry.get(name)
  if (!desc) return false
  desc.enabled = enabled
  return true
}

export function clearRegistry(): void {
  registry.clear()
}
