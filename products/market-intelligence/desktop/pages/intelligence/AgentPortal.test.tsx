import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { AgentPortal } from './AgentPortal'
import { marketIntelligenceAgents } from './agentPortalModel'

const text = productText['zh-CN'].pages.intelligence.portal
const baseSample = { active: false, available: true, busy: false }
const activation = { enabledSourceCount: 1, totalSourceCount: 12 }

function render(active = false): string {
  return renderToStaticMarkup(createElement(AgentPortal, {
    activation,
    agents: marketIntelligenceAgents,
    onOpenSources: () => undefined,
    onPrimary: () => undefined,
    onToggleSample: () => undefined,
    sample: { ...baseSample, active },
    sourceCounts: { crypto: 7 },
    text
  }))
}

describe('AgentPortal sample switch', () => {
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
    const markup = render(true)
    expect(markup).toContain('aria-checked="true"')
    expect(markup).toContain('示例模式')
    expect(markup).not.toContain('示例中')
  })
})
