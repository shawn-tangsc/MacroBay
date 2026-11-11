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
/** 代理横幅与私有源说明共用的那一件：antd `Alert` 只在它里面出现一次。 */
const noticeBanner = readFileSync(resolve(root, 'products/market-intelligence/desktop/shared/NoticeBanner.tsx'), 'utf8')
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
    // 代理横幅不再自己画 Alert：改用共享 `NoticeBanner`（私有源说明同一件），
    // 所以「antd warning Alert」这条判据看那一件，`<Alert` 只允许出现一处。
    expect(component).toContain('<NoticeBanner')
    expect(component).not.toContain('<Alert')
    expect(noticeBanner).toContain('<Alert')
    expect(noticeBanner).toContain('type="warning"')
    expect(noticeBanner).toContain('showIcon')
    // 句面只来自文案表：失败档在「已配好代理」时换另一句，但仍是表里的键，不是硬编码。
    expect(component).toContain('text.body')
    expect(component).toContain('text.configuredFailedBody')
    expect(component).toContain('description={')
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
