// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { PolicyPathStrip } from './PolicyPathStrip'

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

const render = async (candidate: PolicyPathReading | undefined) => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(PolicyPathStrip, { reading: candidate, text, month: '12' })))
  return host
}

describe('policy path strip', () => {
  it('renders the policy readings with the month named in the label', async () => {
    const rendered = await render(reading)
    expect(rendered.textContent).toContain(text.title)
    expect(rendered.textContent).toContain('3.75–4.00%')
    expect(rendered.textContent).toContain('12 月加息概率')
    expect(rendered.textContent).toContain('76%')
    expect(rendered.textContent).toContain('维持 10–2')
    expect(rendered.textContent).toContain(text.projection)
    expect(rendered.textContent).toContain(text.live)
  })

  it('renders nothing without a reading and marks a stale quote', async () => {
    expect((await render(undefined)).firstChild).toBeNull()
    const rendered = await render({ ...reading, staleness: 'stale' })
    expect(rendered.textContent).toContain(text.stale)
    expect(rendered.querySelector('.mi-policy-path')?.getAttribute('data-staleness')).toBe('stale')
  })
})
