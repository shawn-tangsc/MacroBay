// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { PolicyPathCard } from './PolicyPathCard'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.policyPath
const reading: PolicyPathReading = {
  meetingDate: '2026-12-09', daysUntilMeeting: 40, hasProjectionMaterials: true,
  targetRange: { lowerPercent: 3.75, upperPercent: 4 },
  lastDecision: { vote: { for: 10, against: 2 } },
  probability: { venue: 'polymarket', asOf: '2026-10-30T02:10:00.000Z', outcome: 'hike-25', value: 0.76, changeInPp24h: -1, points: 40 },
  staleness: 'live'
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
  await act(async () => root!.render(createElement(PolicyPathCard, { reading: candidate, text, month: '12' })))
  return host
}

describe('policy path card', () => {
  it('leads with the odds and names the month', async () => {
    const rendered = await render(reading)
    expect(rendered.textContent).toContain(text.title)
    expect(rendered.textContent).toContain('76%')
    expect(rendered.textContent).toContain('12 月加息 25bp')
    expect(rendered.textContent).toContain('3.75–4.00%')
    expect(rendered.textContent).toContain('维持 10–2')
    expect(rendered.textContent).toContain(text.projection)
    expect(rendered.textContent).toContain(text.live)
  })

  it('keeps one skeleton: a missing reading becomes a dash, not a shorter card', async () => {
    const rendered = await render({ ...reading, probability: undefined, targetRange: undefined, lastDecision: undefined, staleness: 'unavailable' })
    const rows = rendered.querySelectorAll('.mi-policy-card__facts > div')
    expect(rows).toHaveLength(4)
    expect(rendered.textContent?.match(/—/g)?.length).toBeGreaterThanOrEqual(3)
    expect(rendered.textContent).toContain(text.unavailable)
  })

  it('marks a stale quote with its own colour state', async () => {
    const rendered = await render({ ...reading, staleness: 'stale' })
    expect(rendered.textContent).toContain(text.stale)
    expect(rendered.querySelector('.mi-policy-card')?.getAttribute('data-staleness')).toBe('stale')
  })
})
