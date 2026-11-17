export type Theme = "light" | "dark"
const KEY = "retcon-theme"

export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === "light" || v === "dark" ? v : null
  } catch {
    return null
  }
}

export function getSystemTheme(): Theme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

export function getInitialTheme(): Theme {
  return getStoredTheme() ?? getSystemTheme()
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* storage unavailable; theme still applies for this session */
  }
}
