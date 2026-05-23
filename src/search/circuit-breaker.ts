export class CircuitBreaker {
  private failures = 0
  private lastFailureTime = 0
  private state: "closed" | "open" | "half-open" = "closed"

  constructor(
    private readonly name: string,
    private readonly threshold = 5,
    private readonly cooldownMs = 30000,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.cooldownMs) {
        this.state = "half-open"
      } else {
        throw new CircuitOpenError(this.name, this.cooldownMs)
      }
    }
    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (e) {
      this.onFailure()
      throw e
    }
  }

  get isOpen(): boolean {
    return this.state === "open" && Date.now() - this.lastFailureTime < this.cooldownMs
  }

  private onSuccess(): void {
    this.failures = 0
    this.state = "closed"
  }

  private onFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()
    if (this.failures >= this.threshold) {
      this.state = "open"
    }
  }
}

export class CircuitOpenError extends Error {
  constructor(serviceName: string, cooldownMs: number) {
    super(`Circuit breaker [${serviceName}] is open, retry after ${Math.ceil(cooldownMs / 1000)}s`)
    this.name = "CircuitOpenError"
  }
}

export const circuitBreakers = {
  llm: new CircuitBreaker("llm", 5, 30000),
  embedding: new CircuitBreaker("embedding", 3, 60000),
  webSearch: new CircuitBreaker("webSearch", 5, 60000),
}
