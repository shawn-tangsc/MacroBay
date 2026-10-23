import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 视觉 token 契约（结构断言，不依赖像素）。
 */

const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? ''
}

function rules(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, 'g')) ?? []
}

function hexTokens(block: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    tokens[match[1]] = match[2]
  }
  return tokens
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const size = value.length === 3 ? 1 : 2
  const channels = [0, 1, 2].map((index) => {
    const part = value.slice(index * size, index * size + size)
    return parseInt(size === 1 ? part + part : part, 16) / 255
  })
  return channels.reduce((sum, channel) => sum + channel, 0) / 3
}

describe('PLAT-60 style tokens', () => {
  it('paints the page base exactly once with --bg and no longer uses a rail shell', () => {
    const layout = rules('.settings-layout').find((item) => item.includes('background')) ?? ''
    const page = rule('.settings-workspace.web-search-settings')

    expect(layout).toContain('background: var(--bg)')
    expect(page).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(page).toContain('background: transparent')
    expect(rule('.web-search-provider-rail')).toBe('')
    expect(rule('.web-search-shell')).toBe('')
  })

  it('maps prototype surface/surface-2 onto semantic tokens for both themes', () => {
    const dark = rule('.web-search-settings')
    const light = rule(":root[data-theme='light'] .web-search-settings")
    const drawer = rule('.web-search-provider-drawer')
    const drawerLight = rule(":root[data-theme='light'] .web-search-provider-drawer")

    expect(dark).toContain('--web-search-panel-bg: var(--surface)')
    expect(dark).toContain('--web-search-control-bg: var(--surface-strong)')
    expect(dark).toContain('--web-search-ok: hsl(')
    expect(light).toContain('--web-search-panel-bg: var(--surface-strong)')
    expect(light).toContain('--web-search-control-bg: var(--surface-soft)')
    expect(drawer).toContain('--web-search-panel-bg: var(--surface)')
    expect(drawerLight).toContain('--web-search-control-bg: var(--surface-soft)')
  })

  it('keeps base < panel < control luminance ordering in dark and its inverse in light', () => {
    const root = hexTokens(rule(':root'))
    const light = hexTokens(rule(':root[data-theme="light"]'))

    expect(luminance(root['bg'])).toBeLessThan(luminance(root['surface']))
    expect(luminance(root['surface'])).toBeLessThan(luminance(root['surface-strong']))
    expect(luminance(light['bg'])).toBeGreaterThan(luminance(light['surface-strong']))
    expect(luminance(light['surface-strong'])).toBeGreaterThan(luminance(light['surface-soft']))
  })

  it('matches the prototype page container, tab and summary spacing', () => {
    const content = rule('.web-search-detail-pane')
    const tabs = rule('.web-search-settings-tabs')
    const tab = rule('.web-search-settings-tab')
    const active = rule('.web-search-settings-tab.on')
    const summary = rule('.web-search-summary')
    const chip = rule('.web-search-summary-chip')

    expect(content).toContain('padding: 22px 26px 48px')
    expect(content).toContain('max-width: 1040px')
    expect(tabs).toContain('gap: 2px')
    expect(tabs).toContain('border-bottom: 1px solid var(--border)')
    expect(tab).toContain('padding: 7px 14px')
    expect(tab).toContain('font-size: 13px')
    expect(tab).toContain('color: var(--muted)')
    expect(active).toContain('border-bottom-color: var(--accent)')
    expect(active).toContain('font-weight: 600')
    expect(summary).toContain('gap: 8px')
    expect(summary).toContain('font-variant-numeric: tabular-nums')
    expect(chip).toContain('padding: 3px 10px')
    expect(chip).toContain('border-radius: 999px')
    expect(chip).toContain('font-size: 12px')
  })

  it('uses the panel token for every card with the prototype header treatment', () => {
    const card = rule('.web-search-settings-card')
    const header = rule('.web-search-settings-card > .section-heading')
    const title = rule('.web-search-settings-card > .section-heading > span')

    expect(card).toContain('background: var(--web-search-panel-bg)')
    expect(card).toContain('border: 1px solid var(--border)')
    expect(card).toContain('border-radius: 8px')
    expect(header).toContain('padding: 10px 14px')
    expect(header).toContain('border-bottom: 1px solid var(--border)')
    expect(title).toContain('font-size: 13px')
    expect(title).toContain('font-weight: 600')
  })

  it('styles inputs, selects and unit controls from control token with the 132/260 grid', () => {
    const control = css.match(/\.web-search-settings \.ant-input,[\s\S]*?\{[^}]*\}/)?.[0] ?? ''
    const number = rule('.web-search-settings .ant-input-number')
    const row = rule('.web-search-form-row')

    expect(control).toContain('.ant-select-selector')
    expect(control).toContain('background: var(--web-search-control-bg) !important')
    expect(control).toContain('border: 1px solid var(--border) !important')
    expect(control).toContain('border-radius: 6px !important')
    expect(control).toContain('min-height: 28px !important')
    expect(number).toContain('height: 28px')
    expect(row).toContain('grid-template-columns: 132px 260px minmax(0, 1fr)')
    expect(row).toContain('gap: 10px 14px')
    expect(rule('.web-search-input-narrow')).toContain('width: 120px')
    expect(rule('.web-search-unit-select')).toContain('width: 110px')
    expect(rule('.web-search-form-label')).toContain('text-align: right')
    expect(rule('.web-search-form-row-wide .web-search-form-control')).toContain('width: 100%')
  })

  it('styles the provider table, filters, badges and folded more row', () => {
    const wrap = rule('.web-search-provider-table-wrap')
    const table = rule('.web-search-provider-table')
    const cells = css.match(/\.web-search-provider-table th,\n\.web-search-provider-table td\s*\{[^}]*\}/)?.[0] ?? ''
    const filter = rule('.web-search-filter-chip')
    const filterActive = rule('.web-search-filter-chip.on')
    const badge = rule('.web-search-badge')
    const badgeOn = rule('.web-search-badge-on')
    const badgeDefault = rule('.web-search-badge-default')
    const more = rule('.web-search-providers-more')

    expect(wrap).toContain('border: 1px solid var(--border)')
    expect(wrap).toContain('border-radius: 8px')
    expect(table).toContain('border-collapse: collapse')
    expect(cells).toContain('padding: 9px 12px')
    expect(cells).toContain('border-bottom: 1px solid var(--border)')
    expect(rule('.web-search-provider-table th')).toContain('background: var(--web-search-control-bg)')
    expect(filter).toContain('border-radius: 999px')
    expect(filter).toContain('font-size: 12px')
    expect(filterActive).toContain('color: var(--accent)')
    expect(badge).toContain('border-radius: 999px')
    expect(badge).toContain('font-size: 10px')
    expect(badgeOn).toContain('--web-search-ok')
    expect(badgeDefault).toContain('var(--accent)')
    expect(more).toContain('padding: 9px 12px')
    expect(more).toContain('border-top: 1px solid var(--border)')
  })

  it('styles the drawer as a card with a two-column 120px/1fr field grid and hints below', () => {
    const header = rule('.web-search-provider-drawer .ant-drawer-header')
    const body = rule('.web-search-provider-drawer .ant-drawer-body')
    const footer = rule('.web-search-provider-drawer .ant-drawer-footer')
    const row = rule('.web-search-drawer-body .web-search-form-row')
    const hint = rule('.web-search-drawer-body .web-search-form-hint')
    const readonly = rule('.web-search-drawer-readonly')
    const endpoint = rule('.web-search-endpoint-readonly')
    const error = rule('.web-search-drawer-error')

    expect(header).toContain('padding: 10px 14px')
    expect(header).toContain('border-bottom: 1px solid var(--border)')
    expect(body).toContain('padding: 16px 20px')
    expect(body).toContain('width: 100%')
    expect(footer).toContain('padding: 12px 14px')
    expect(row).toContain('grid-template-columns: 120px minmax(0, 1fr)')
    expect(hint).toContain('grid-column: 2')
    expect(readonly).toContain('color: var(--muted)')
    expect(readonly).toContain('font-size: 12px')
    expect(endpoint).toContain('font-family: ui-monospace')
    expect(endpoint).not.toContain('border: 1px')
    expect(error).toContain('color: var(--danger)')
    expect(rule('.web-search-provider-drawer-root .ant-drawer-mask')).toContain('background:')
  })

  it('keeps primary-button text on-accent across base/hover/active/disabled', () => {
    const base = css.match(/button\.ant-primary-button\.ant-btn\s*\{[^}]*\}/)?.[0] ?? ''
    const hover = css.match(/button\.ant-primary-button\.ant-btn:not\(:disabled\):hover[\s\S]*?\{[^}]*\}/)?.[0] ?? ''
    const active = css.match(/button\.ant-primary-button\.ant-btn:not\(:disabled\):active[\s\S]*?\{[^}]*\}/)?.[0] ?? ''
    const disabled = css.match(/button\.ant-primary-button\.ant-btn:disabled[\s\S]*?\{[^}]*\}/)?.[0] ?? ''

    expect(base).toContain('color: var(--accent-contrast)')
    expect(hover).toContain('color: var(--accent-contrast)')
    expect(active).toContain('color: var(--accent-contrast)')
    expect(disabled).toContain('color: var(--accent-contrast)')
    expect(disabled).toContain('opacity: 0.45')
    for (const block of [base, hover, active, disabled]) {
      expect(block).not.toContain('#fff')
      expect(block).not.toContain('#ffffff')
      expect(block).not.toContain('rgb(255')
    }
  })

  it('scopes section-heading typography to its direct title span so button labels inherit button color', () => {
    expect(css).toContain('.section-heading > span {')
    expect(css).not.toMatch(/\.section-heading span\s*\{/)
  })

  it('does not hardcode hex colors anywhere in the web search page styles', () => {
    const start = css.indexOf('PLAT-55 原型视觉映射')
    const end = css.indexOf('.web-search-floating-status')
    const pageStyles = css.slice(start, end > start ? end : undefined)

    expect(pageStyles.length).toBeGreaterThan(1000)
    expect(pageStyles).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
