import React, { useContext } from "react"
import { theme as antdTheme } from "antd"

export type ThemeMode = "light" | "dark"

export const ThemeContext = React.createContext<{
  theme: ThemeMode
  toggleTheme: () => void
}>({
  theme: "dark",
  toggleTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

const THEME_KEY = "kb-theme"

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark"
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === "light" || stored === "dark") return stored
  } catch {}
  return getSystemTheme()
}

export function setStoredTheme(mode: ThemeMode) {
  try { localStorage.setItem(THEME_KEY, mode) } catch {}
}

export function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") return "dark"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function watchSystemTheme(cb: (mode: ThemeMode) => void) {
  const mql = window.matchMedia("(prefers-color-scheme: dark)")
  const handler = (e: MediaQueryListEvent) => cb(e.matches ? "dark" : "light")
  mql.addEventListener("change", handler)
  return () => mql.removeEventListener("change", handler)
}

export const antdDarkTheme = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorBgContainer: "#27272a",
    colorBgElevated: "#18181b",
    colorBorder: "#3f3f46",
    colorText: "#d4d4d8",
    colorTextPlaceholder: "#71717a",
    colorPrimary: "#3b82f6",
    borderRadius: 6,
  },
  components: {
    Input: { colorBgContainer: "#27272a" },
    Select: { colorBgContainer: "#27272a", colorBgElevated: "#18181b" },
    InputNumber: { colorBgContainer: "#27272a" },
    Switch: { colorPrimary: "#3b82f6", colorPrimaryHover: "#60a5fa" },
    Button: { colorBgContainer: "#27272a", colorBorder: "#3f3f46" },
    Tag: { colorBgContainer: "#27272a" },
    Slider: { trackBg: "#3f3f46" },
  },
}

export const antdLightTheme = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",
    colorBorder: "#e4e4e7",
    colorText: "#3f3f46",
    colorTextPlaceholder: "#a1a1aa",
    colorPrimary: "#3b82f6",
    borderRadius: 6,
  },
  components: {
    Input: { colorBgContainer: "#ffffff" },
    Select: { colorBgContainer: "#ffffff", colorBgElevated: "#ffffff" },
    InputNumber: { colorBgContainer: "#ffffff" },
    Switch: { colorPrimary: "#3b82f6", colorPrimaryHover: "#60a5fa" },
    Button: { colorBgContainer: "#ffffff", colorBorder: "#d4d4d8" },
    Tag: { colorBgContainer: "#f4f4f5" },
    Slider: { trackBg: "#d4d4d8" },
  },
}
