// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { ConfirmProvider } from '@platform/ui/components/confirm'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import { EconomicCalendarEventDetail } from './EconomicCalendarEventDetail'
import type { EconomicCalendarEventView } from './economicCalendarModel'

/**
 * 官方详情的「重要性」只照记录自己带的值渲染。
 *
 * 用户 2026-11-15：这一行原先写死「高」——今天库里官方那些行恰好全是 high，所以字面上没错，
 * 但那是数据巧合，不是代码保证。缺省必须说「未提供」，有哪一档就说哪一档。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
const asOf = '2026-11-06T14:00:00.000Z'

function event(overrides: Partial<EconomicCalendarEventView> = {}): EconomicCalendarEventView {
  return {
    eventKey: 'US.NONFARM_PAYROLLS.RELEASE.2026-M10',
    eventFamily: 'employment-situation',
    titleKey: 'nonfarm-payrolls',
    countryCode: 'US',
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

async function renderImportance(target: EconomicCalendarEventView): Promise<string> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <ShellTimeZoneProvider timeZone="UTC"><ConfirmProvider>
      <EconomicCalendarEventDetail
        event={target} now={() => new Date(asOf)} onRefresh={async () => undefined}
        onReleaseTimeChanged={async () => undefined} releaseTimeClient={client} refreshState={undefined} text={text}
        officialConsensus={null} linkedConsensus={undefined}
      />
    </ConfirmProvider></ShellTimeZoneProvider>
  ))
  const rows = Array.from(host.querySelectorAll('dt'))
  return rows.find((dt) => dt.textContent === text.details.importance)?.nextElementSibling?.textContent ?? ''
}

it('未分级时写「未分级（这类事件我们还没有分级）」，不写「暂无」、也不冒充高', async () => {
  const shown = await renderImportance(event({ importance: undefined }))
  expect(shown).toBe(text.market.importanceUnratedDetail)
  expect(shown).toContain('未分级')
  expect(shown).toContain('还没有分级')
  // 「暂无」是「没有」，这里是「我们还没定」——同一个概念不许两种说法。
  expect(shown).not.toBe(text.market.missingValue)
  expect(shown).not.toBe(text.market.importance.high)
})

it('shows every level the record actually carries, not only the highest', async () => {
  expect(await renderImportance(event({ importance: 'high' }))).toBe(text.market.importance.high)
  expect(await renderImportance(event({ importance: 'medium' }))).toBe(text.market.importance.medium)
  expect(await renderImportance(event({ importance: 'low' }))).toBe(text.market.importance.low)
})
