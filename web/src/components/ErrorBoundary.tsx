import { Component, type ReactNode } from "react"
import { useTheme } from "../theme"

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

function ErrorUI({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { theme } = useTheme()
  const isDark = theme === "dark"
  return (
    <div className={`h-screen flex flex-col items-center justify-center ${isDark ? "bg-zinc-950 text-zinc-100" : "bg-gray-50 text-gray-900"} p-6`}>
      <div className="max-w-md w-full text-center space-y-4">
        <div className="text-4xl">&#x26A0;&#xFE0F;</div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className={`text-sm break-words ${isDark ? "text-zinc-400" : "text-gray-500"}`}>
          {error.message || "Unknown error"}
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={onRetry}
            className={`px-4 py-2 rounded-md text-sm transition-colors ${isDark ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700" : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-300"}`}
          >
            Retry
          </button>
          <button
            onClick={() => window.location.reload()}
            className={`px-4 py-2 rounded-md border text-sm transition-colors ${isDark ? "border-zinc-700 text-zinc-400 hover:text-zinc-200" : "border-gray-300 text-gray-500 hover:text-gray-900"}`}
          >
            Refresh Page
          </button>
        </div>
      </div>
    </div>
  )
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
    if (this.state.hasError && this.state.error) {
      return <ErrorUI error={this.state.error} onRetry={this.handleReload} />
    }

    return this.props.children
  }
}
