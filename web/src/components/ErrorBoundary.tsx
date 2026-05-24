import { Component, type ReactNode } from "react"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[ErrorBoundary] UI crash:", error, info.componentStack)
  }

  private handleReload = () => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-4xl">&#x26A0;&#xFE0F;</div>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-zinc-400 break-words">
              {this.state.error?.message || "Unknown error"}
            </p>
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={this.handleReload}
                className="px-4 py-2 rounded-md bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700 transition-colors"
              >
                Retry
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-md border border-zinc-700 text-zinc-400 text-sm hover:text-zinc-200 transition-colors"
              >
                Refresh Page
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
