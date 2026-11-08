// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import { EconomicCalendarEventDetail } from './EconomicCalendarEventDetail'
import type { EconomicCalendarEventView } from './economicCalendarModel'

const text = productText['zh-CN'].pages.intelligence.portal.calendar
const asOf = '2026-11-06T14:00:00.000Z'

function event(overrides: Partial<EconomicCalendarEventView> = {}): EconomicCalendarEventView {
  return {
    eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M10',
    eventFamily: 'employment-situation',
    titleKey: 'nonfarm-payrolls',
    periodKey: '2026-M10',
    lifecycleState: 'released',
    coverage: 'available',
    scheduledDate: '2026-11-06',
    scheduledAt: '2026-11-06T13:30:00.000Z',
    releaseTimeSource: 'official',
    detectedAt: asOf,
    actual: { displayValue: '165' },
    previous: { displayValue: '29' },
    caveats: [],
    category: 'employment',
    labelKey: 'nonfarm-payrolls',
    sources: ['blsAutomaticSchedule'],
    ...overrides
  }
}

// The stub returns the whole contract result, not just its `state`: a test fixture that is narrower
// than the contract compiles where nothing imports the test and fails where something does.
const client = {
  setReleaseTime: vi.fn(async () => ({ state: 'saved' as const, scheduledAt: asOf, scheduledDate: '2026-11-06' })),
  clearReleaseTime: vi.fn(async () => ({ state: 'cleared' as const }))
}

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function render(detail: Parameters<typeof EconomicCalendarEventDetail>[0]) {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <ShellTimeZoneProvider timeZone="UTC"><ConfirmProvider>{<EconomicCalendarEventDetail {...detail} />}</ConfirmProvider></ShellTimeZoneProvider>
  ))
  return host
}

const base = { event: event(), now: () => new Date(asOf), onRefresh: async () => undefined, onReleaseTimeChanged: async () => undefined, releaseTimeClient: client, refreshState: undefined, text }

describe('the record times on the detail', () => {
  /**
   * R36：创建时间 = 第一次落库（修订不改变它）；实际值时间 = 第一次拿到非空现值那一刻的
   * **来源观测时刻**。三条时间故意互不相等：发布 10-28 18:00、观测 10-30 14:40、创建 10-30 08:35，
   * 显示成哪个都不会靠巧合对上。
   */
  it('shows when the record was created and when the value was received, never the publication time', async () => {
    const host = await render({
      ...base,
      event: event({
        createdAt: '2026-10-30T08:35:28.000Z',
        actualDetectedAt: '2026-10-30T14:40:21.000Z',
        publishedAt: '2026-10-28T18:00:00.000Z'
      }),
      officialConsensus: null,
      linkedConsensus: undefined
    })
    const rows = Array.from(host.querySelectorAll('dt'))
    const valueOf = (label: string): string | null =>
      rows.find((dt) => dt.textContent === label)?.nextElementSibling?.textContent ?? null

    expect(valueOf(text.recordTimes.createdAt)).toContain('08:35')
    expect(valueOf(text.recordTimes.actualDetectedAt)).toContain('14:40')
    // 观测时刻不是发布时刻：页面里不许出现 18:00 被当成「拿到值的时间」。
    expect(valueOf(text.recordTimes.actualDetectedAt)).not.toContain('18:00')
  })

  it('omits both rows when the record carries neither time', async () => {
    const host = await render({ ...base, officialConsensus: null, linkedConsensus: undefined })
    const labels = Array.from(host.querySelectorAll('dt')).map((dt) => dt.textContent)
    expect(labels).not.toContain(text.recordTimes.createdAt)
    expect(labels).not.toContain(text.recordTimes.actualDetectedAt)
  })
})

describe('the official detail’s expectation row', () => {
  it('uses the official consensus when there is one, without a source note', async () => {
    const host = await render({ ...base, officialConsensus: { displayValue: '180' } })
    const row = host.querySelector('[data-consensus]')!
    expect(row.getAttribute('data-consensus')).toBe('official')
    expect(row.textContent).toContain('180')
    expect(row.textContent).not.toContain(text.details.consensusFromMarket)
  })

  it('falls back to the market consensus and says where it came from', async () => {
    const host = await render({ ...base, officialConsensus: null, linkedConsensus: { displayValue: '6.5万' } })
    const row = host.querySelector('[data-consensus]')!
    expect(row.getAttribute('data-consensus')).toBe('market')
    expect(row.textContent).toContain('6.5万')
    expect(row.textContent).toContain(text.details.consensusFromMarket)
  })

  it('says the expectation is missing only when neither side has an observation', async () => {
    const host = await render({ ...base, officialConsensus: undefined, linkedConsensus: undefined })
    const row = host.querySelector('[data-consensus]')!
    expect(row.getAttribute('data-consensus')).toBe('missing')
    expect(row.textContent).toContain(text.details.consensusMissing)
    // 未知不能说成结论：不出现「没有超预期」，也没有任何差值。
    expect(host.textContent).not.toContain(text.market.surpriseUnavailable)
    expect(row.textContent).not.toMatch(/\d+%?/)
  })

  it('tells "could not read it" apart from "there is nothing to read", with the gap named', async () => {
    const missing = await render({ ...base, officialConsensus: undefined, linkedConsensus: undefined })
    const unreadable = await render({ ...base, officialConsensus: undefined, linkedConsensus: null })
    const unreadableRow = unreadable.querySelector('[data-consensus]')!
    expect(unreadableRow.getAttribute('data-consensus')).toBe('unreadable')
    expect(unreadableRow.textContent).toContain(text.details.consensusUnreadable)
    // 右列的数据缺口必须**恰好一条**并点名原因：零条是没写，两条是同一件事说两遍。
    const gaps = unreadable.querySelectorAll('[data-consensus-gap]')
    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.textContent).toBe(text.details.consensusUnreadableReason)
    // 「没有观测」那一边不该出现缺口行。
    expect(missing.querySelectorAll('[data-consensus-gap]')).toHaveLength(0)
    // 同一条断言钉死两种处境：句子必须不同，防止有人又合并回去。
    expect(unreadableRow.textContent).not.toBe(missing.querySelector('[data-consensus]')?.textContent)
    expect(unreadableRow.textContent).not.toContain(text.details.consensusMissing)
  })
})
