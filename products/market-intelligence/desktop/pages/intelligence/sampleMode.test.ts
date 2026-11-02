import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The light theme remaps the portal palette onto platform tokens in exactly one place.
 *
 * This went wrong twice in the same corner: the block mapped the neutrals and the accent but
 * kept the dark-theme positive / negative / caution values, so on white the numbers read at
 * 1.83:1 and looked washed out. Reading the file is cruder than looking at a screenshot, but it
 * is the only check that cannot miss it again — a missing line fails here.
 */
const portalCss = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/sampleMode.css'),
  'utf8'
)

const themeSources = [
  resolve(process.cwd(), 'platform/ui/tokens/tokens.css'),
  resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css')
].map((path) => readFileSync(path, 'utf8')).join('\n')

const lightBlock = (() => {
  const start = portalCss.indexOf(":root[data-theme='light'] .mi-sample-surface {")
  expect(start).toBeGreaterThan(-1)
  const end = portalCss.indexOf('\n}', start)
  return portalCss.slice(start, end)
})()

/** Every semantic colour the portal palette promises, and the token it must resolve to. */
const required = {
  '--mi-dashboard-line': '--border',
  '--mi-dashboard-surface': '--surface',
  '--mi-dashboard-text': '--text',
  '--mi-dashboard-muted': '--muted',
  '--mi-dashboard-lime': '--accent',
  '--mi-dashboard-positive': '--success',
  '--mi-dashboard-caution': '--caution',
  '--mi-dashboard-negative': '--danger'
} as const

describe('portal palette in the light theme', () => {
  it.each(Object.entries(required))('maps %s to a platform token', (name, token) => {
    const line = lightBlock.split('\n').find((candidate) => candidate.trim().startsWith(`${name}:`))
    expect(line, `${name} is missing from the light remap`).toBeDefined()
    expect(line).toContain(`var(${token})`)
  })

  it('keeps every semantic name pointing at a token the theme layer really defines', () => {
    for (const token of Object.values(required)) {
      expect(themeSources, `${token} is not defined by the theme layer`).toContain(`${token}:`)
    }
  })

  it('carries no literal colour left in the light remap', () => {
    const declarations = lightBlock.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(declarations).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})
