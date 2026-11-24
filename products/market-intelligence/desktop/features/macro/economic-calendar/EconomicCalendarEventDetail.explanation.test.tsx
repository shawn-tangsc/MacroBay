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
 * 官方详情的「事件说明」（R36 #34）。官方四个源的标题键是另一套身份，产品定了接到同一段文案：
 * **只对 `(titleKey, US)` 生效**，未列标题键与 `unknown` 一律整段不出现。
 */
const text = productText['zh-CN'].pages.intelligence.portal.calendar
const asOf = '2026-11-06T14:00:00.000Z'

function event(overrides: Partial<EconomicCalendarEventView> = {}): EconomicCalendarEventView {
  return {
    eventKey: 'US.CPI.RELEASE.2026-M10', eventFamily: 'consumer-price-index', titleKey: 'cpi',
    countryCode: 'US', periodKey: '2026-M10', lifecycleState: 'released', coverage: 'available',
    scheduledDate: '2026-11-13', scheduledAt: '2026-11-13T13:30:00.000Z', releaseTimeSource: 'official',
    detectedAt: asOf, actual: { displayValue: '3.2%' }, previous: { displayValue: '3.0%' }, caveats: [],
    category: 'inflation', labelKey: 'cpi', sources: ['blsManualIcs'],
    ...overrides
  }
}

const client = {
  setReleaseTime: vi.fn(async () => ({ state: 'saved' as const, scheduledAt: asOf, scheduledDate: '2026-11-13' })),
  clearReleaseTime: vi.fn(async () => ({ state: 'cleared' as const }))
}

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
})

async function renderHost(target: EconomicCalendarEventView): Promise<HTMLElement> {
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
  return host
}

it('官方 CPI 行：三段说明逐字出现，与市场那条 CPI 读同一段', async () => {
  const host = await renderHost(event())
  const paragraphs = [...host.querySelectorAll('[data-calendar-explanation] p')].map((node) => node.textContent)
  expect(paragraphs).toEqual([text.explanations.cpi.what, text.explanations.cpi.why, text.explanations.cpi.watch])
  // 与市场抽屉同一条理由：宿主 `<aside>` 是 aria-live="polite"，静态参考不该随选择播报。
  expect(host.querySelector('[data-calendar-explanation]')?.getAttribute('aria-live')).toBe('off')
})

it('未列标题键：整段不出现，也不拿名字里带 cpi 的那段顶上', async () => {
  const host = await renderHost(event({ titleKey: 'retail-sales', labelKey: 'unknown', category: 'consumption' }))
  expect(host.querySelector('[data-calendar-explanation]')).toBeNull()
  expect(host.textContent).not.toContain(text.explanations.cpi.what)
})

it('unknown 标题键（讲话、会议）：没有说明', async () => {
  const host = await renderHost(event({ titleKey: 'unknown', labelKey: 'unknown', eventFamily: 'fomc' }))
  expect(host.querySelector('[data-calendar-explanation]')).toBeNull()
})