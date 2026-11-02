// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { productText } from '../../shared/i18n/productText'
import type { PolicyPathSettlement } from '../../../contracts/policyPath'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { PolicyPathCard } from './PolicyPathCard'

const text = productText['zh-CN'].pages.intelligence.portal.dashboard.policyPath
const reading: PolicyPathReading = {
  meetingDate: '2026-12-09', daysUntilMeeting: 40, hasProjectionMaterials: true,
  phase: { kind: 'normal' },
  targetRange: { lowerPercent: 3.75, upperPercent: 4 },
  lastDecision: { vote: { for: 10, against: 2 }, outcome: 'no-change' },
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

// The card resolves its state word through the shell language now, so the test has to supply the
// same context the app does — a card whose copy is English but whose pill says 实时 is exactly the
// bug that missing context hides.
const render = async (candidate: PolicyPathReading, cardText: typeof text = text, language: 'zh-CN' | 'en-US' = 'zh-CN') => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(ShellLanguageProvider, { language },
    createElement(PolicyPathCard, { reading: candidate, text: cardText, month: '12' }))))
  return host
}

it('explains the odds in the drawer instead of a hand-drawn bubble on the card', async () => {
  const rendered = await render(reading)
  // The card keeps the number; the explanation lives where the numbers' basis lives.
  expect(rendered.querySelector('[role="tooltip"]')).toBeNull()
  expect(rendered.querySelector('[role="note"]')).toBeNull()
})

describe('policy path card', () => {
  it('names the month and the bucket through one localized template, with no Chinese left in English', async () => {
    const rendered = await render(reading, productText['en-US'].pages.intelligence.portal.dashboard.policyPath, 'en-US')
    expect(rendered.textContent).not.toMatch(/[\u4e00-\u9fa5]/)
    expect(rendered.textContent).toContain(reading.probability!.outcome === 'hike-25' ? 'hike 25bp' : '')
  })
  it('leads with the odds and names the month', async () => {
    const rendered = await render(reading)
    expect(rendered.textContent).toContain(text.title)
    expect(rendered.textContent).toContain('76.0%')
    expect(rendered.textContent).toContain('12 月加息 25bp')
    // The label follows the leading bucket: a hold or a cut must not still read 'hike'.
    expect(rendered.textContent).toContain(text.outcomes['hike-25'])
    expect(rendered.textContent).toContain('3.75–4.00%')
    expect(rendered.textContent).toContain('维持 · 10–2')
    expect(rendered.textContent).toContain(text.projection)
    expect(rendered.textContent).toContain(text.live)
  })

  it('carries the vote hint in the accessible name, without adding a focus stop', async () => {
    const rendered = await render(reading)
    // A `dd` is not a control: `title` hides the hint from keyboard users, and `tabIndex` puts a
    // stop in the Tab order where nothing happens. The hint belongs to the accessible name.
    expect(rendered.querySelector('dd[title]')).toBeNull()
    expect(rendered.querySelector('dd[tabindex]')).toBeNull()
    const hinted = rendered.querySelector('dd[aria-label]')
    expect(hinted).not.toBeNull()
    expect(hinted?.getAttribute('aria-label')).toContain('10')
    expect(hinted?.getAttribute('aria-label')).not.toContain('{')
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

describe('policy path card labels', () => {
  it('names the leading bucket instead of a fixed hike', async () => {
    const rendered = await render({
      ...reading,
      probability: { ...reading.probability!, outcome: 'no-change', value: 0.62 }
    })
    expect(rendered.textContent).toContain(text.outcomes['no-change'])
    expect(rendered.textContent).not.toContain(text.outcomes['hike-25'])
  })
})

const settlement: PolicyPathSettlement = {
  decidedMeetingDate: '2026-12-09',
  previousTargetRange: { lowerPercent: 3.75, upperPercent: 4 },
  actualOutcome: 'hike-25',
  priced: 0.38,
  pricedOutcome: 'no-change',
  conclusion: { kind: 'relative', direction: 'hawkish', surprisePp: 62 },
  nextMeeting: { meetingDate: '2027-01-27', daysUntil: 50 }
}

describe('policy path card shapes', () => {
  it('upgrades inside two weeks: one marker, what the median implies, and the venue quote', async () => {
    const rendered = await render({
      ...reading,
      phase: { kind: 'pre-meeting', daysLeft: 6 },
      markers: [{ kind: 'repricing', level: 'strong', changeInPp: 8.4 }],
      probability: {
        ...reading.probability!,
        changeInPp24h: 1.2,
        quote: { bid: 0.7, ask: 0.71 },
        range30d: { min: 0.63, max: 0.78 }
      },
      sep: {
        asOf: '2026-09-16', medianPath: { y2026: 4.1 }, medianCurrentYear: 4.1, previousMedian: 4.1,
        stepsFromCurrent: 1, previousStepsFromCurrent: 0,
        sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomcprojtabl20260916.htm'
      }
    })

    expect(rendered.querySelector('.mi-policy-card')?.getAttribute('data-phase')).toBe('pre-meeting')
    expect(rendered.textContent).toContain(text.phasePreMeeting.replace('{days}', '6'))
    // One chip, and it names the strongest move with its size.
    const marker = rendered.querySelector('.mi-policy-card__marker')
    expect(marker?.getAttribute('data-level')).toBe('strong')
    expect(marker?.textContent).toContain('重定价 +8.4pp')
    expect(rendered.querySelectorAll('.mi-policy-card__marker')).toHaveLength(1)
    expect(rendered.querySelector('.mi-policy-card__upgrade')?.textContent).toContain('委员会中位比区间中点高 1 次 25bp')
    expect(rendered.textContent).toContain('上季同项 0 次 · 中位 4.1% vs 区间中点 3.88%')
    expect(rendered.textContent).toContain('买卖 70 / 71 · 近 30 日 63–78%')
    // The countdown block carries the median and the quote, so the fact list is two rows.
    expect(rendered.querySelectorAll('.mi-policy-card__facts > div')).toHaveLength(2)
    expect(rendered.querySelector('.mi-policy-card__chip')).toBeNull()
  })

  it('settles the realised band against the price before it, quantitatively', async () => {
    const rendered = await render({
      ...reading,
      meetingDate: '2027-01-27',
      daysUntilMeeting: 50,
      phase: { kind: 'settlement', minutesSinceDecision: 42 },
      settlement,
      targetRange: { lowerPercent: 4, upperPercent: 4.25 },
      lastDecision: { vote: { for: 9, against: 3 } },
      probability: undefined,
      staleness: 'unavailable'
    })

    expect(rendered.querySelector('.mi-policy-card')?.getAttribute('data-phase')).toBe('settlement')
    expect(rendered.textContent).toContain(text.phaseSettlement)
    expect(rendered.textContent).toContain('加息 25bp')
    expect(rendered.textContent).toContain('12-09 实际')
    expect(rendered.textContent).toContain('相对定价偏鹰 +62pp')
    expect(rendered.textContent).toContain('决议前 1 小时定价 38.0%')
    expect(rendered.textContent).toContain('实际落在 加息 25bp 档 · 之前主档「维持利率」')
    expect(rendered.textContent).toContain('4.00–4.25%')
    expect(rendered.textContent).toContain('9–3')
    expect(rendered.textContent).toContain('01-27 · 50 天')
    expect(rendered.textContent).toContain('结算后 42 分钟')
    // A judgement word is not a conclusion: the comparison is arithmetic.
    expect(rendered.textContent).not.toContain('鹰派')
    expect(rendered.textContent).not.toContain('鸽派')
    expect(rendered.querySelectorAll('.mi-policy-card__facts > div')).toHaveLength(3)
  })

  it('shows neither conclusion nor pricing strip when there was no price before the decision', async () => {
    const rendered = await render({
      ...reading,
      phase: { kind: 'settlement', minutesSinceDecision: 300 },
      settlement: {
        ...settlement,
        priced: undefined,
        pricedOutcome: undefined,
        conclusion: { kind: 'unavailable', reason: 'settlement-pricing-unavailable' }
      },
      probability: undefined,
      staleness: 'unavailable'
    })

    expect(rendered.querySelector('.mi-policy-card__verdict')).toBeNull()
    // The strip body carries the price it settled against; without one it must not render at all.
    expect(rendered.querySelector('.mi-policy-card__upgrade')).toBeNull()
  })

  it('keeps the normal body in the verdict and remembers the gap in one clickable grey line', async () => {
    let opened = 0
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(createElement(PolicyPathCard, {
      reading: {
        ...reading,
        meetingDate: '2027-01-27',
        daysUntilMeeting: 50,
        phase: { kind: 'verdict', daysSinceDecision: 1 },
        settlement,
        probability: { ...reading.probability!, outcome: 'no-change', value: 0.66, changeInPp24h: 0.4 }
      },
      text,
      month: '1',
      onOpen: () => { opened += 1 }
    })))

    expect(host.querySelector('.mi-policy-card')?.getAttribute('data-phase')).toBe('verdict')
    expect(host.textContent).toContain('66.0%')
    expect(host.querySelectorAll('.mi-policy-card__facts > div')).toHaveLength(4)
    // The verdict does not take the header chip: the header is the normal one again.
    expect(host.querySelector('.mi-policy-card__phase')).toBeNull()
    const judged = host.querySelector('.mi-policy-card__judged')
    expect(judged?.textContent).toContain('已判定 · 上次相对定价')
    expect(judged?.textContent).toContain('偏鹰 +62pp')
    expect(judged?.querySelector('b')?.getAttribute('data-direction')).toBe('hawkish')
    // The whole line opens the drawer, where the full explanation lives.
    await act(async () => (judged as HTMLButtonElement).click())
    expect(opened).toBe(1)
  })

  it('names the last decision direction in the verdict row instead of a fixed hold', async () => {
    const rendered = await render({
      ...reading,
      phase: { kind: 'verdict', daysSinceDecision: 1 },
      settlement,
      // The reading carries what the decision did; the settlement's own answer is only a fallback.
      lastDecision: { vote: { for: 10, against: 2 }, outcome: 'hike-25' }
    })
    expect(rendered.textContent).toContain('加息 25bp · 10–2')
  })

  it('can carry an intraday marker without upgrading the card', async () => {
    const rendered = await render({
      ...reading,
      markers: [{ kind: 'intraday', level: 'normal', changeInPp: 3.4 }]
    })
    const marker = rendered.querySelector('.mi-policy-card__marker')
    expect(marker?.getAttribute('data-level')).toBe('normal')
    expect(marker?.textContent).toContain('盘中 +3.4pp')
    expect(rendered.querySelector('.mi-policy-card__upgrade')).toBeNull()
  })
})

describe('policy path card markers', () => {
  it('does not carry a repricing chip into the settlement strip', async () => {
    const rendered = await render({
      ...reading,
      phase: { kind: 'settlement', minutesSinceDecision: 42 },
      markers: [{ kind: 'repricing', level: 'strong', changeInPp: 8.4 }],
      settlement
    })
    // The series behind that marker is the next meeting's; on the strip it would read as the verdict.
    expect(rendered.querySelector('.mi-policy-card__marker')).toBeNull()
  })
})

describe('policy path card distribution', () => {
  it('names only the buckets above 5% and folds the rest into one label', async () => {
    const rendered = await render({
      ...reading,
      probability: {
        ...reading.probability!,
        distribution: { 'no-change': 0.285, 'hike-25': 0.69, 'hike-50-plus': 0.0155, 'cut-25': 0.008, 'cut-50-plus': 0.004 }
      }
    })
    // The bar reads high to low, then one grey 其他 block: two named bands plus the rest.
    const bars = [...rendered.querySelectorAll('.mi-policy-card__bar > i')]
    expect(bars).toHaveLength(3)
    expect(bars[0]?.getAttribute('data-outcome')).toBe('hike-25')
    expect(bars[1]?.getAttribute('data-outcome')).toBe('no-change')
    expect(bars[2]?.getAttribute('data-outcome')).toBe('other')
    const named = [...rendered.querySelectorAll('.mi-policy-card__mix > span:not(.mi-policy-card__mix-rest)')]
    expect(named).toHaveLength(2)
    expect(named[0]?.textContent).toContain('69.0%')
    expect(named[1]?.textContent).toContain('28.5%')
    // 1.55 + 0.8 + 0.4 = 2.75 → 2.8%, all at or below 5%.
    expect(rendered.querySelector('.mi-policy-card__mix-rest')?.textContent).toContain('2.8%')
  })

  it('drops the line when the payload has no distribution', async () => {
    const rendered = await render(reading)
    expect(rendered.querySelector('.mi-policy-card__mix')).toBeNull()
  })
})

describe('policy path card markers', () => {
  it('does not carry a repricing chip into the settlement strip', async () => {
    const rendered = await render({
      ...reading,
      phase: { kind: 'settlement', minutesSinceDecision: 42 },
      markers: [{ kind: 'repricing', level: 'strong', changeInPp: 8.4 }],
      settlement
    })
    // The series behind that marker is the next meeting's; on the strip it would read as the verdict.
    expect(rendered.querySelector('.mi-policy-card__marker')).toBeNull()
  })
})

