export type Theme = 'torn' | 'discord'

const storageKey = 'runTrackerTheme'

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(storageKey)
    if (stored === 'discord') return 'discord'
    if (stored !== 'torn') localStorage.setItem(storageKey, 'torn')
    return 'torn'
  } catch {
    return 'torn'
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content', theme === 'discord' ? '#1e1f22' : '#292929',
  )
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    localStorage.setItem(storageKey, theme)
  } catch {
    // The theme still works for this tab when browser storage is unavailable.
  }
}

export function isThemeStorageEvent(event: StorageEvent): boolean {
  return event.key === storageKey || event.key === null
}
