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
  pricedDistribution: {
    'no-change': 0.59, 'hike-25': 0.38, 'hike-50-plus': 0.01, 'cut-25': 0.01, 'cut-50-plus': 0.01
  },
  nextMeeting: { meetingDate: '2027-01-27', daysUntil: 50 }
}

const reading: PolicyPathReading = {
  meetingDate: '2027-01-27', daysUntilMeeting: 50, hasProjectionMaterials: false,
  phase: { kind: 'settlement', minutesSinceDecision: 42 },
  settlement,
  targetRange: { lowerPercent: 4, upperPercent: 4.25 },
  lastDecision: {
    vote: { for: 9, against: 3 },
    statementUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20261209a.htm'
  },
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
    expect(section?.textContent).toContain('12-09 · 加息 25bp')
    expect(section?.textContent).toContain('9–3')
    // Leading band, realised band, and everything else as one number: no five-bucket ladder.
    expect(section?.textContent).toContain('维持利率 59.0% · 加息 25bp 38.0% · 其他 3.0%')
    expect(section?.textContent).toContain('相对定价偏鹰 +62pp（实际档当时只被定价 38.0%）')
    const statement = section?.querySelector('a')
    expect(statement?.getAttribute('href')).toBe(reading.lastDecision?.statementUrl)
    expect(statement?.textContent).toContain(text.settlementStatementLink)
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
        pricedDistribution: undefined,
        conclusion: { kind: 'unavailable', reason: 'settlement-pricing-unavailable' }
      }
    })
    const section = rendered.querySelector('[data-settlement]')
    // The reason lives here, in the drawer - the card does not carry a strip that cannot answer.
    expect(section?.textContent).toContain(text.settlementConclusionMissing)
    // No pre-decision price row: the section says the conclusion is missing instead of quoting a baseline.
    expect(section?.textContent).not.toContain(text.settlementPricingBefore)
  })
})

describe('policy drawer distribution', () => {
  it('lists every bucket, not only the one the card leads with', async () => {
    const rendered = await render({
      ...reading,
      phase: { kind: 'normal' },
      settlement: undefined,
      probability: {
        venue: 'polymarket', asOf: '2026-10-31T05:39:50.406Z', outcome: 'hike-25', value: 0.69, points: 40,
        distribution: { 'no-change': 0.285, 'hike-25': 0.69, 'hike-50-plus': 0.0155, 'cut-25': 0.008, 'cut-50-plus': 0.004 }
      }
    })
    const rows = rendered.querySelectorAll('.mi-policy-drawer__distribution tbody tr')
    expect(rows).toHaveLength(5)
    expect(rendered.textContent).toContain('维持')
    expect(rendered.textContent).toContain('28.5%')
    expect(rendered.textContent).toContain('69.0%')
    // No observation a day or a week back yet: dashes, not zeros.
    expect(rows[3]?.textContent).toContain('—')
  })
})

describe('policy path drawer uncollected sections', () => {
  it('renders the shared empty state for each official section it has not collected yet', async () => {
    const rendered = await render({
      ...reading,
      phase: { kind: 'normal' },
      settlement: undefined,
      lastDecision: undefined,
      sep: undefined
    })
    // SEP and the previous decision are two sections that fill in independently; each one says "not yet"
    // through the shared surface instead of a paragraph the drawer wrote itself.
    expect(rendered.querySelectorAll('[data-state="empty"]')).toHaveLength(2)
    // No hand-written empty paragraph survives beside the shared component.
    expect(rendered.querySelector('.mi-policy-drawer__empty')).toBeNull()
  })
})
