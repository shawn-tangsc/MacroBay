// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../../shared/i18n/productText'

/**
 * 事件详情抽屉里的「事件说明」（R36 #34）：固定文案、按指标码的族取键。
 *
 * 两条判据都是产品定的形态：
 * - 登记过的族 → **三段都在**，逐字等于文案表（它不是模型写的，换一天打开也一样）；
 * - 未登记的族 → **整段不出现**：没有空标题、没有占位行、不拿别的族的文案顶上。
 */

const scoped = (node: React.ReactElement): React.ReactElement => <ShellTimeZoneProvider timeZone="UTC">{node}</ShellTimeZoneProvider>
const text = productText['zh-CN'].pages.intelligence.portal.calendar

const base = {
  eventKey: '00000000-0000-4000-8000-0000000000e1', title: '美国 10 月 CPI 年率', countryCode: 'US',
  eventType: 'economic-indicator' as const, importance: 'high' as const, scheduledAt: '2026-11-13T13:30:00.000Z',
  consensus: { displayValue: '3.0%' }, providerPrevious: { displayValue: '3.0%' }, providerActual: { displayValue: '3.2%' },
  source: 'Narwhal' as const, sourceObservedAt: '2026-11-13T13:31:00.000Z', coverage: 'observed-unverified' as const
}

it('已登记的高档族：三段说明逐字出现，顺序是 是什么 → 为什么值得看 → 看哪里', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, eventNameKey: 'US.CPI.NSA.YOY' }} text={text} />)))
    const paragraphs = [...host.querySelectorAll('[data-calendar-explanation] p')].map((node) => node.textContent)
    expect(paragraphs).toEqual([text.explanations.cpi.what, text.explanations.cpi.why, text.explanations.cpi.watch])
    // 同一段文字只由文案表提供：抽屉里不再抄一遍句子。
    expect(host.querySelector('[data-calendar-explanation]')?.textContent).toBe(paragraphs.join(''))
  } finally { await act(async () => root.unmount()) }
})

it('未登记的族：整段不出现，不留空行也不写兜底句', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, eventNameKey: 'US.PPI.NONE.YOY' }} text={text} />)))
    expect(host.querySelector('[data-calendar-explanation]')).toBeNull()
    // 没有拿别的族的文案顶上：CPI 与 PPI 是两份发布，PPI 那一行不该读到 CPI 的说明。
    expect(host.textContent).not.toContain(text.explanations.cpi.what)
  } finally { await act(async () => root.unmount()) }
})

it('没有身份的行（讲话、旧源未登记）：没有指标码就没有说明', async () => {
  const { MarketCalendarInspector } = await import('./MarketCalendarEvents')
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(scoped(<MarketCalendarInspector event={{ ...base, eventNameKey: undefined,
      eventType: 'central-bank-activity', consensus: null, providerPrevious: null, providerActual: null }} text={text} />)))
    expect(host.querySelector('[data-calendar-explanation]')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})