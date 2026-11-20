const themeKey = "nami.theme"

export function initialDarkMode() {
  try {
    const saved = localStorage.getItem(themeKey)
    if (saved === "dark" || saved === "light") return saved === "dark"
  } catch {
    // Storage can be unavailable in restricted browsers.
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

export function applyDarkMode(enabled: boolean) {
  document.documentElement.classList.toggle("dark", enabled)
  try {
    localStorage.setItem(themeKey, enabled ? "dark" : "light")
  } catch {
    // Keep the selected theme for this page when storage is unavailable.
  }
}
