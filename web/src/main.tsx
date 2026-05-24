import React, { useState, useEffect, useCallback } from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ConfigProvider } from "antd"
import ErrorBoundary from "./components/ErrorBoundary"
import App from "./App"
import { ThemeContext, type ThemeMode, getStoredTheme, setStoredTheme, watchSystemTheme, antdDarkTheme, antdLightTheme } from "./theme"
import "./styles/index.css"

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(getStoredTheme)

  useEffect(() => watchSystemTheme((m) => {
    if (!localStorage.getItem("kb-theme")) setMode(m)
  }), [])

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next = prev === "dark" ? "light" : "dark"
      setStoredTheme(next)
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", mode)
  }, [mode])

  const antdTheme = mode === "dark" ? antdDarkTheme : antdLightTheme

  return (
    <ThemeContext.Provider value={{ theme: mode, toggleTheme }}>
      <ConfigProvider theme={antdTheme}>
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
