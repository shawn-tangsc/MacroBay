import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The requirement bar must look the same on macOS and Windows.
 *
 * History: it used to be a hand-rolled strip whose colours came from `color-mix(in srgb, var(--warning) ...)`.
 * `--warning` is **not** a platform token (only `--border`/`--text`/`--danger`/`--accent` are), so the
 * border/background/colour declarations were invalid at computed-value time and the bar collapsed to
 * bare text on Windows while the flex layout survived. It is now an antd `Alert` — the one banner
 * style every platform already renders — and the product stylesheet only owns its spacing.
 */
const root = process.cwd()
const component = readFileSync(resolve(root, 'products/market-intelligence/desktop/shared/NetworkProxyBanner.tsx'), 'utf8')
const css = readFileSync(
  resolve(root, 'products/market-intelligence/desktop/settings/intelligence-sources/intelligence-sources.css'),
  'utf8'
)

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  if (!match) throw new Error(`Missing rule: ${selector}`)
  return match[1] ?? ''
}

describe('proxy requirement bar', () => {
  it('renders the platform Alert with the proxy action', () => {
    expect(component).toContain('<Alert')
    expect(component).toContain('type="warning"')
    expect(component).toContain('description={text.body}')
    expect(component).toContain('data-network-proxy-settings')
  })

  it('leaves only spacing in the product stylesheet', () => {
    const bar = rule('.mi-network-proxy-banner')
    expect(bar).toContain('margin:')
    // Colours belong to the theme provider; the sheet must not depend on a token it never defines.
    expect(bar).not.toContain('color-mix(')
    expect(bar).not.toContain('var(--warning')
    expect(bar).not.toContain('background:')
  })

  it('never reads the warning token without a fallback anywhere in this sheet', () => {
    expect(css).not.toMatch(/var\(--warning\)/)
  })
})
