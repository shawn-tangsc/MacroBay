// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { PolicyPathSettlement } from '../../../contracts/policyPath'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { PolicyPathDrawer } from './PolicyPathDrawer'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.policyPath

const settlement: PolicyPathSettlement = {
  decidedMeetingDate: '2026-12-09',
  previousTargetRange: { lowerPercent: 3.75, upperPercent: 4 },
  actualOutcome: 'hike-25',
  priced: 0.38,
  pricedOutcome: 'no-change',
  conclusion: { kind: 'relative', direction: 'hawkish', surprisePp: 62 },
  nextMeeting: { meetingDate: '2027-01-27', daysUntil: 50 }
}

const reading: PolicyPathReading = {
  meetingDate: '2027-01-27', daysUntilMeeting: 50, hasProjectionMaterials: false,
  phase: { kind: 'settlement', minutesSinceDecision: 42 },
  settlement,
  targetRange: { lowerPercent: 4, upperPercent: 4.25 },
  lastDecision: { vote: { for: 9, against: 3 } },
  staleness: 'unavailable'
}

let root: Root | undefined
let host: HTMLDivElement | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

const render = async (candidate: PolicyPathReading) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(PolicyPathDrawer, { reading: candidate, text, onClose: () => {} })))
  return host
}

describe('policy path drawer settlement', () => {
  it('adds the settlement section with the realised band, the price before it and the gap', async () => {
    const rendered = await render(reading)
    const section = rendered.querySelector('[data-settlement]')
    expect(section).not.toBeNull()
    expect(section?.textContent).toContain(text.settlementTitle)
    expect(section?.textContent).toContain('加息 25bp')
    expect(section?.textContent).toContain('12-09 实际')
    expect(section?.textContent).toContain('38%')
    expect(section?.textContent).toContain('维持利率')
    expect(section?.textContent).toContain('相对定价 +62pp')
    expect(section?.textContent).toContain('3.75–4.00%')
    expect(section?.textContent).toContain('4.00–4.25%')
    expect(section?.textContent).toContain('9–3')
    expect(section?.textContent).toContain('01-27 · 50 天')
    expect(section?.textContent).not.toContain('鹰派')
    expect(section?.textContent).not.toContain('鸽派')
  })

  it('names the missing price before the decision instead of inventing a conclusion', async () => {
    const rendered = await render({
      ...reading,
      settlement: {
        ...settlement,
        priced: undefined,
        pricedOutcome: undefined,
        conclusion: { kind: 'unavailable', reason: 'settlement-pricing-unavailable' }
      }
    })
    const section = rendered.querySelector('[data-settlement]')
    expect(section?.textContent).toContain(text.settlementPricedMissing)
    expect(section?.textContent).toContain(text.settlementConclusionMissing)
  })
})
