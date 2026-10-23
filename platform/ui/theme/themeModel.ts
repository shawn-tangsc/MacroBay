import type { AccentColor, ThemeMode } from '../../settings/schema/appSettings'

export type ResolvedThemeMode = Exclude<ThemeMode, 'system'>

export function resolveThemeMode(themeMode: ThemeMode, systemPrefersDark: boolean): ResolvedThemeMode {
  if (themeMode === 'system') return systemPrefersDark ? 'dark' : 'light'
  return themeMode
}

export function toThemeAttributes(themeMode: ThemeMode, accentColor: AccentColor, systemPrefersDark: boolean): Record<string, string> {
  return {
    'data-theme': resolveThemeMode(themeMode, systemPrefersDark),
    'data-theme-mode': themeMode,
    'data-accent': accentColor
  }
}
