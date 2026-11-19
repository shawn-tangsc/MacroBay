// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'
import type { CalendarValueRevisionRead } from '../../../shared/ipc/marketCalendarClient'
import type { MarketCalendarEvent } from '../../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 数值修订的四条显示口径（用户 2026-11-20）：
 * ① 有身份 + 有记录：≥2 个来源才并列，1 个只写来源；「更新于」只用读口的 `updatedAt`；
 * ② 有身份 + 没记录：写「未记录」；
 * ③ 没有身份：**整块不渲染**（不是「未记录」——那是把我们的缺口说成审计问题）；
 * ④ 读不到：错误态 + 重试，不画成空、也不写成「未记录」。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar

const answer = vi.fn<() => Promise<CalendarValueRevisionRead>>()
vi.mock('../../../shared/ipc/marketCalendarClient', () => ({
  marketCalendarClient: { queryValueRevisions: () => answer() }
}))

const base = {
  eventKey: 'e1', title: 'CPI', countryCode: 'US', eventNameKey: 'US.CPI.NSA.YOY',
  eventType: 'economic-indicator', importance: 'high', scheduledAt: '2026-11-10T13:30:00.000Z',
  sourceObservedAt: '2026-11-10T13:40:00.000Z', coverage: 'observed-unverified',
  periodKey: '2026-10', firstScheduledDate: '2026-11-10'
} as unknown as MarketCalendarEvent

const recorded = (providers: readonly string[]): CalendarValueRevisionRead => ({
  state: 'recorded',
  revisions: providers.map((providerId, index) => ({
    field: 'actual', valueBefore: index === 0 ? null : '165', valueAfter: String(165 + index),
    decision: 'write', providerId, observedAt: `2026-11-19T0${5 + index}:00:00.000Z`
  })),
  byField: {},
  updatedAt: '2026-11-19T06:00:00.000Z',
  latestWriteProviderId: providers[providers.length - 1] ?? null
})

let root: Root | undefined
let host: HTMLDivElement | undefined
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  answer.mockReset()
})
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
})

async function render(event: MarketCalendarEvent): Promise<void> {
  const { EventValueRevisions } = await import('./EventValueRevisions')
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <dl><EventValueRevisions event={event} text={text} /></dl>
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  await act(async () => { await Promise.resolve() })
}

describe('数值修订的四种显示', () => {
  it('shows the parallel rows only when two providers wrote, and uses the port updatedAt', async () => {
    answer.mockResolvedValue(recorded(['0xrouter', 'narwhal']))
    await render(base)
    const block = host!.querySelector('[data-value-revisions="recorded"]')!
    expect(block.getAttribute('data-provider-count')).toBe('2')
    expect(host!.querySelectorAll('[data-revision-row]')).toHaveLength(2)
    // 「更新于」只认读口给的 updatedAt（write 的最后一条），不是标准表时间。
    // 显示按读者时区（这里固定东八）：06:00Z → 14:00 GMT+8；关键是它来自 updatedAt，不是标准表时间。
    expect(host!.querySelector('[data-revisions-updated]')?.textContent).toContain('14:00')
  })

  it('shows a single source line, not a parallel pair, when only one provider wrote', async () => {
    answer.mockResolvedValue(recorded(['narwhal']))
    await render(base)
    expect(host!.querySelector('[data-revisions-source]')?.textContent).toContain('narwhal')
    expect(host!.querySelector('[data-revisions-parallel]')).toBeNull()
  })

  it('writes 未记录 when the period has no revision record', async () => {
    answer.mockResolvedValue({ state: 'not-recorded' })
    await render(base)
    const block = host!.querySelector('[data-value-revisions="not-recorded"]')!
    expect(block.textContent).toContain('未记录')
  })

  it('renders nothing at all for a row with no identity', async () => {
    // 讲话行没有指标码/期次：没有身份就谈不上「有没有记录」，整块不渲染。
    const speech = { ...base, eventNameKey: undefined, periodKey: undefined, firstScheduledDate: undefined,
      eventType: 'central-bank-activity' } as unknown as MarketCalendarEvent
    await render(speech)
    expect(host!.querySelector('[data-value-revisions]')).toBeNull()
    expect(answer).not.toHaveBeenCalled()
  })

  it('shows an error state with retry when the read fails, never 未记录', async () => {
    answer.mockResolvedValue({ state: 'unreadable' })
    await render(base)
    const block = host!.querySelector('[data-value-revisions="unreadable"]')!
    expect(block.querySelector('.state-view--error')).not.toBeNull()
    expect(host!.textContent).not.toContain('未记录')
  })
})
