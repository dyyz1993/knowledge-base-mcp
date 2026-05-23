import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { createSession, destroyBrowser, type ManagedSession, type BrowserLaunchOptions } from "@dyyz1993/xbrowser"
import { loadConfig } from "../config.js"
import { createLogger } from "../utils/logger.js"


const logger = createLogger("chat:browser-launcher")
const MACOS_PATHS = [
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
]

const LINUX_PATHS = [
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]

function getPlaywrightPaths(): string[] {
  const home = homedir()
  if (process.platform === "darwin") {
    return [`${home}/Library/Caches/ms-playwright`]
  }
  if (process.platform === "linux") {
    return [`${home}/.cache/ms-playwright`]
  }
  return []
}

function findPlaywrightChromium(cacheDir: string): string | null {
  try {
    const entries = readdirSync(cacheDir)
    const chromiumEntry = entries.find(e => e.startsWith("chromium-"))
    if (!chromiumEntry) return null

    if (process.platform === "darwin") {
      const p = `${cacheDir}/${chromiumEntry}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`
      return existsSync(p) ? p : null
    }
    if (process.platform === "linux") {
      const p = `${cacheDir}/${chromiumEntry}/chrome-linux/chrome`
      return existsSync(p) ? p : null
    }
    if (process.platform === "win32") {
      const p = `${cacheDir}\\${chromiumEntry}\\chrome-win\\chrome.exe`
      return existsSync(p) ? p : null
    }
  } catch (e) {
    logger.warn(e instanceof Error ? e.message : String(e))
  }
  return null
}

function getWindowsPaths(): string[] {
  const localAppData = process.env.LOCALAPPDATA || ""
  const userProfile = process.env.USERPROFILE || ""
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    localAppData ? `${localAppData}\\Google\\Chrome\\Application\\chrome.exe` : "",
    userProfile ? `${userProfile}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe` : "",
  ].filter(Boolean)
}

export function detectBrowserPath(): string | null {
  let paths: string[] = []

  if (process.platform === "darwin") {
    paths = [...MACOS_PATHS]
  } else if (process.platform === "linux") {
    paths = [...LINUX_PATHS]
  } else if (process.platform === "win32") {
    paths = [...getWindowsPaths()]
  }

  for (const p of paths) {
    if (existsSync(p)) return p
  }

  for (const cacheDir of getPlaywrightPaths()) {
    const found = findPlaywrightChromium(cacheDir)
    if (found) return found
  }

  return null
}

export interface BrowserSessionResult {
  session: ManagedSession
  mode: "cdp" | "local"
}

export async function launchBrowserForScrape(url: string): Promise<BrowserSessionResult> {
  const config = loadConfig()
  const opts: BrowserLaunchOptions = { headless: config.browser.headless }

  if (config.browser.cdpEndpoint) {
    opts.cdpEndpoint = config.browser.cdpEndpoint
    const session = await createSession(`kb-scrape-${Date.now()}`, url, opts)
    return { session, mode: "cdp" }
  }

  if (config.browser.executablePath) {
    opts.executablePath = config.browser.executablePath
    const session = await createSession(`kb-scrape-${Date.now()}`, url, opts)
    return { session, mode: "local" }
  }

  const detected = detectBrowserPath()
  if (detected) {
    opts.executablePath = detected
    const session = await createSession(`kb-scrape-${Date.now()}`, url, opts)
    return { session, mode: "local" }
  }

  const session = await createSession(`kb-scrape-${Date.now()}`, url, opts)
  return { session, mode: "local" }
}

export async function cleanupBrowser(): Promise<void> {
  await destroyBrowser()
}
