import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

const portalStyles = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'),
  'utf8'
)
const dashboardStyles = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/cryptoDashboard.css'),
  'utf8'
)
const sampleSurfaceStyles = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/sampleMode.css'),
  'utf8'
)
const portal = readFileSync(
  resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/AgentPortal.tsx'),
  'utf8'
)
const portalContentRule = portalStyles.match(/\.mi-agent-portal__content\s*\{([^}]*)}/)?.[1] ?? ''
const portalGridRule = portalStyles.match(/\.mi-agent-portal__grid\s*\{([^}]*)}/)?.[1] ?? ''
const narrowPortalGridRule = portalStyles.match(
  /@media \(max-width: 439px\)\s*\{[\s\S]*?\.mi-agent-portal__grid\s*\{([^}]*)}/
)?.[1] ?? ''

function cssBlock(styles: string, marker: string): string {
  const markerIndex = styles.indexOf(marker)
  const blockStart = styles.indexOf('{', markerIndex)
  if (markerIndex < 0 || blockStart < 0) return ''

  let depth = 0
  for (let index = blockStart; index < styles.length; index += 1) {
    if (styles[index] === '{') depth += 1
    if (styles[index] === '}') depth -= 1
    if (depth === 0) return styles.slice(blockStart + 1, index)
  }

  return ''
}

function cssRule(styles: string, selector: string): string {
  return cssBlock(styles, selector)
}

import { productText } from '../../shared/i18n/productText'
import { AgentPortal } from './AgentPortal'
import { marketIntelligenceAgents } from './agentPortalModel'

/** A configured reader: the layout cases only need the progress chip to exist. */
const activation = { status: 'ready' as const, enabledSourceCount: 1, totalSourceCount: 12 }
const sample = { active: false, available: true, busy: false }

describe('market intelligence agent portal layout', () => {
  it('keeps the message-analysis history out of the intelligence overview', () => {
    const text = productText['zh-CN'].pages.intelligence.portal
    const markup = renderToStaticMarkup(
      createElement(AgentPortal, {
        activation,
        agents: marketIntelligenceAgents,
        onOpenSources: () => undefined,
        onPrimary: () => undefined,
        onRetryActivation: () => undefined,
        onToggleSample: () => undefined,
        sample,
        text
      })
    )

    expect(markup).not.toContain(text.analysisTimeline.entry)
    expect(portal).not.toContain('mi-analysis-timeline-entry')
    expect(portal).not.toContain('onOpenAnalysisTimeline')
  })

  it('renders a theme-following portal with fixed analyst images and dense card metadata', () => {
    const markup = renderToStaticMarkup(
      createElement(AgentPortal, {
        activation,
        agents: marketIntelligenceAgents,
        onOpenSources: () => undefined,
        onPrimary: () => undefined,
        onRetryActivation: () => undefined,
        onToggleSample: () => undefined,
        sample,
        text: productText['zh-CN'].pages.intelligence.portal
      })
    )

    expect(portal).toContain('<img')
    expect(portal).toContain('portraitAsset')
    expect(portal).toContain('mi-agent-card__lens')
    expect(portal).toContain('mi-agent-card__footer')
    expect(portal).toContain('mi-agent-card__entry')
    // H2 之后事实变了：示例开关用平台 `Switch`，不再手绘轨道/滑块，也没有独立类名。
    // 这条守同一件事的另一面——**用组件**，并且旧类名连样式一起清掉（留一条没人用的样式，
    // 下一个就会照着它再自绘一个开关）。
    expect(portal).toContain('<Switch')
    expect(portal).toContain("from 'antd'")
    expect(portal).not.toContain('mi-agent-card__switch')
    expect(portalStyles).not.toContain('mi-agent-card__switch')
    expect(portal).toContain('disabled={!isAvailable}')
    expect(portal).toContain('onClick={isAvailable ? onPrimary : undefined}')
    expect(portalStyles).toContain('--mi-terminal-bg')
    expect(portalStyles).toContain('var(--mi-terminal-bg)')
    expect(portalStyles).toContain(":root[data-theme='light'] .mi-agent-portal")
    expect(portalStyles).toContain('object-fit: cover')
    expect((markup.match(/<img/g) ?? [])).toHaveLength(3)
    expect(markup).toContain('CRYPTO MARKET LENS')
    expect(markup).toContain('示例模式')
    expect(markup).not.toContain('选择市场 Agent')
  })

  it('maps the portal palette to platform tokens in light theme', () => {
    const lightPortalRule = cssRule(portalStyles, ":root[data-theme='light'] .mi-agent-portal")

    expect(lightPortalRule).toContain('--mi-terminal-bg: var(--bg)')
    expect(lightPortalRule).toContain('--mi-terminal-surface: var(--surface)')
    expect(lightPortalRule).toContain('--mi-terminal-surface-strong: var(--surface-strong)')
    expect(lightPortalRule).toContain('--mi-terminal-border: var(--border)')
    expect(lightPortalRule).toContain('--mi-terminal-border-strong: var(--border-strong)')
    expect(lightPortalRule).toContain('--mi-terminal-text: var(--text)')
    expect(lightPortalRule).toContain('--mi-terminal-muted: color-mix(')
    expect(lightPortalRule).toContain('var(--muted)')
    // Lime `--accent` is not readable as text on white, so the light accent is derived from it.
    expect(lightPortalRule).toContain('--mi-terminal-lime: color-mix(in srgb, var(--accent)')
    expect(lightPortalRule).toContain('--mi-terminal-lime-line: color-mix(in srgb, var(--accent)')
  })

  it('overrides the portal card hard-coded dark surfaces in light theme', () => {
    const firstCardRule = cssRule(portalStyles, ":root[data-theme='light'] .mi-agent-card:first-child")
    const statusRule = cssRule(portalStyles, ":root[data-theme='light'] .mi-agent-card__status")
    const footerRule = cssRule(portalStyles, ":root[data-theme='light'] .mi-agent-card__footer")
    const portraitRule = cssRule(portalStyles, ":root[data-theme='light'] .mi-agent-card__portrait")
    const portraitOverlayRule = cssRule(portalStyles, ":root[data-theme='light'] .mi-agent-card__portrait::after")
    const portraitImageRule = cssRule(portalStyles, ":root[data-theme='light'] .mi-agent-card__portrait img")

    expect(firstCardRule).toContain('linear-gradient')
    expect(firstCardRule).toContain('var(--surface)')
    expect(statusRule).toContain('var(--warning, #c48a2a)')
    expect(statusRule).toContain('var(--text-strong)')
    expect(footerRule).toContain('border-top-color: var(--border)')
    expect(portraitRule).toContain('background: var(--surface-soft)')
    expect(portraitOverlayRule).toContain('linear-gradient')
    expect(portraitOverlayRule).toContain('var(--surface)')
    // The darkening filter is replaced by a near-neutral light-theme treatment.
    expect(portraitImageRule).toContain('brightness(1.02)')
    expect(portraitImageRule).not.toContain('brightness(0.72)')
  })

  it('maps the portal palette to platform tokens in light theme', () => {
    // The palette belongs to the portal root, not to the dashboard shell: the brief page is a
    // *sibling* of the dashboard under `.mi-sample-surface`, so tokens declared on the dashboard
    // never reach it — 58 `var()` references resolved to nothing, silently.
    const lightPortalRule = cssRule(sampleSurfaceStyles, ":root[data-theme='light'] .mi-sample-surface")
    const lightDashboardRule = cssRule(dashboardStyles, ":root[data-theme='light'] .mi-crypto-dashboard")
    const lightHeadingRule = cssRule(dashboardStyles, ":root[data-theme='light'] .mi-crypto-dashboard h1")

    expect(lightPortalRule).toContain('--mi-dashboard-line: var(--border)')
    expect(lightPortalRule).toContain('--mi-dashboard-surface: var(--surface)')
    expect(lightPortalRule).toContain('--mi-dashboard-text: var(--text)')
    expect(lightPortalRule).toContain('--mi-dashboard-muted: var(--muted)')
    expect(lightPortalRule).toContain('--mi-dashboard-lime: color-mix(in srgb, var(--accent)')
    expect(lightDashboardRule).toContain('--mi-dashboard-surface-muted: var(--surface-soft)')
    expect(lightDashboardRule).toContain('var(--bg)')
    expect(lightHeadingRule).toContain('color: var(--text-strong)')
    // One owner per value: the dashboard shell must not re-declare what the portal root owns.
    expect(lightDashboardRule).not.toContain('--mi-dashboard-line:')
    expect(lightDashboardRule).not.toContain('--mi-dashboard-muted:')
  })

  it('declares the portal palette once, on the portal root both pages share', () => {
    const portalRootRule = cssRule(sampleSurfaceStyles, '.mi-sample-surface')
    const dashboardRule = cssRule(dashboardStyles, '.mi-crypto-dashboard')

    for (const token of [
      '--mi-dashboard-line', '--mi-dashboard-surface', '--mi-dashboard-text',
      '--mi-dashboard-muted', '--mi-dashboard-lime', '--mi-dashboard-positive',
      '--mi-dashboard-caution', '--mi-dashboard-negative'
    ]) {
      expect(portalRootRule, token).toContain(`${token}:`)
      expect(dashboardRule, token).not.toContain(`${token}:`)
    }
  })

  it('uses fixed-width cards that wrap from the left without stretching the portal grid', () => {
    expect(portalStyles).toContain('--mi-page-inline: 32px')
    expect(portalStyles).toContain('--mi-page-block: 32px')
    expect(portalGridRule).toContain('grid-template-columns: repeat(auto-fill, 400px)')
    expect(portalGridRule).toContain('justify-content: start')
    expect(portalGridRule).toContain('gap: 16px')
    expect(portalGridRule).not.toContain('1fr')
    expect(portalGridRule).not.toContain('space-between')
    expect(portalGridRule).not.toContain('grid-template-columns: repeat(3, minmax(0, 1fr))')
    expect(portalContentRule).not.toContain('max-width')
    expect(portalContentRule).not.toContain('margin-inline')
    expect(narrowPortalGridRule).toContain('grid-template-columns: minmax(0, 400px)')
    expect(narrowPortalGridRule).not.toContain('1fr')
    expect(portalStyles).toContain('height: 160px')
    expect(portalStyles).toContain('minmax(86px, 28%)')
    expect(portalStyles).toContain('--mi-page-inline: 24px')
    expect(portalStyles).toContain('--mi-page-inline: 20px')
  })
})
