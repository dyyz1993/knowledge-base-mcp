import { homedir } from "node:os"

export function buildSpawnEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? homedir(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TERM: process.env.TERM ?? "xterm-256color",
    NODE_ENV: process.env.NODE_ENV ?? "production",
    ...extra,
  }
}

export function gitEnv(): Record<string, string> {
  return buildSpawnEnv({ GIT_TERMINAL_PROMPT: "0" })
}

export function codegraphEnv(): Record<string, string> {
  return buildSpawnEnv()
}

export function curlEnv(): Record<string, string> {
  const proxy =
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.all_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    ""
  const extra: Record<string, string> = {}
  if (proxy) {
    extra.https_proxy = proxy
    extra.http_proxy = proxy
  }
  return buildSpawnEnv(extra)
}
