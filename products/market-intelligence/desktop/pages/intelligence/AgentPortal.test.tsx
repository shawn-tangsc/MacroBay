import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { AgentPortal } from './AgentPortal'
import { marketIntelligenceAgents } from './agentPortalModel'
import type { ActivationState } from './agentActivationPolicy'

const text = productText['zh-CN'].pages.intelligence.portal
const baseSample = { active: false, available: true, busy: false }
const ready: ActivationState = { status: 'ready', enabledSourceCount: 1, totalSourceCount: 12 }

function render(activation: ActivationState = ready, active = false, onRetryActivation = () => undefined): string {
  return renderToStaticMarkup(createElement(AgentPortal, {
    activation,
    agents: marketIntelligenceAgents,
    onOpenSources: () => undefined,
    onPrimary: () => undefined,
    onRetryActivation,
    onToggleSample: () => undefined,
    sample: { ...baseSample, active },
    sourceCounts: { crypto: 7 },
    text
  }))
}

describe('AgentPortal activation read', () => {
  it('puts the switch in the old status slot and source readiness on the right', () => {
    const markup = render()
    expect(markup).toContain('7 个静态情报源')
    expect(markup).toContain('打开看板')
    expect(markup).toContain('role="switch"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain('示例模式')
    expect(markup).toContain('已启用 1/12')
  })

  it('shows the switch as on while the sample is active', () => {
    const markup = render(ready, true)
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('示例模式')
    expect(markup).not.toContain('示例中')
  })

  it('says the read failed instead of drawing an empty or switched-off setup', () => {
    const markup = render({ status: 'unavailable' })
    expect(markup).toContain('暂时读不到')
    expect(markup).toContain('再试一次')
    expect(markup).not.toContain(text.data.sourcesNotConfigured)
    expect(markup).not.toContain(text.data.sourcesNotEnabled)
    expect(markup).not.toContain('已启用')
    expect(markup).not.toMatch(/0\/0/)
  })

  it('says the sources are switched off when a configured setup has none enabled', () => {
    // Twelve visible providers and none enabled is not "nothing configured": the reader did
    // configure, and their next move is to switch one on, not to set the whole thing up.
    const markup = render({ status: 'ready', enabledSourceCount: 0, totalSourceCount: 12 })
    expect(markup).toContain(text.data.sourcesNotEnabled)
    expect(markup).toContain(text.data.enableSources)
    expect(markup).not.toContain(text.data.sourcesNotConfigured)
    expect(markup).not.toContain('暂时读不到')
    expect(markup).not.toMatch(/0\/12/)
  })

  it('offers the configuring action when nothing is configured at all', () => {
    const markup = render({ status: 'ready', enabledSourceCount: 0, totalSourceCount: 0 })
    expect(markup).toContain(text.data.sourcesNotConfigured)
    expect(markup).toContain(text.data.configureSources)
    expect(markup).not.toContain(text.data.sourcesNotEnabled)
    expect(markup).not.toContain('暂时读不到')
    expect(markup).not.toMatch(/0\/0/)
  })

  it('renders the retry control only for a failed read', () => {
    const failed = render({ status: 'unavailable' }, false, vi.fn())
    const empty = render({ status: 'ready', enabledSourceCount: 0, totalSourceCount: 0 })
    expect(failed).toContain('再试一次')
    expect(empty).not.toContain('再试一次')
  })
})
