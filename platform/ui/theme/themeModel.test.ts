import { describe, expect, it } from 'vitest'

import { resolveThemeMode, toThemeAttributes } from './themeModel'

describe('theme model', () => {
  it('resolves system theme from the current system preference', () => {
    expect(resolveThemeMode('system', true)).toBe('dark')
    expect(resolveThemeMode('system', false)).toBe('light')
  })

  it('builds stable theme attributes for the renderer root', () => {
    expect(toThemeAttributes('light', 'cyan', true)).toEqual({
      'data-theme': 'light',
      'data-theme-mode': 'light',
      'data-accent': 'cyan'
    })
    expect(toThemeAttributes('dark', 'cyan', false)).toEqual({
      'data-theme': 'dark',
      'data-theme-mode': 'dark',
      'data-accent': 'cyan'
    })
    expect(toThemeAttributes('system', 'lime', true)['data-theme']).toBe('dark')
    expect(toThemeAttributes('system', 'lime', false)['data-theme']).toBe('light')
  })
})
