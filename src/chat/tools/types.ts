export interface OpenAITool {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type ToolProgressCallback = (progress: { step: string; status: string; output?: unknown }) => void
