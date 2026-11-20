// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'

import { MacroIndicatorDrawer } from './MacroIndicatorDrawer'
import { productText } from '../../shared/i18n/productText'
import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { CalendarDrawerRequest } from './macroIndicatorDrawerModel'

/**
 * 入口带定位（用户 2026-11-16 判为缺陷，不是优化）：
 *
 * 「看板日历卡那颗图标点了只把抽屉打开，不落到它自己指的那个月」——`MarketCalendarCard` 一直把
 * `month` 递上来（窄到行的入口还带 `eventKey`），页面层把参数丢了，于是抽屉停在它上一次的位置。
 * 读者点了 3 月那张卡，看到的是 11 月。
 *
 * 这条用例钉三件事：
 * 1. 带 `month` 的请求落到那个月（不是停在上一次读的月份）；
 * 2. 带 `eventKey` 的请求把那条事件的详情打开——**等那个月的读数回来再找**，找不到就只停在月上，
 *    不编一条、也不假装打开了；
 * 3. 定位只随**请求序号**生效一次：读者自己翻过月份之后，页面再渲染不许把他拽回来；
 * 4. 关掉外层抽屉，内层详情跟着消失（以前只清外层，详情留在整窗左缘）。
 */
const policyText = productText['zh-CN'].pages.intelligence.portal.dashboard.policyPath

let root: Root | undefined
let host: HTMLDivElement | undefined
const originalRect = Element.prototype.getBoundingClientRect

/** 图的尺寸只认量到的值；happy-dom 没有布局，喂一个固定盒子。 */
function stubLayout(width = 490, height = 192): void {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => height })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height })
  Element.prototype.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({})
  }) as DOMRect
}

beforeEach(() => stubLayout())

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  document.body.innerHTML = ''
  for (const key of ['clientWidth', 'clientHeight', 'offsetHeight']) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
  }
  Element.prototype.getBoundingClientRect = originalRect
})

function dayEvent(key: string, title: string, scheduledAt: string): MarketCalendarEvent {
  return {
    eventKey: key, title, countryCode: 'US', countryName: '美国',
    eventType: 'economic-indicator', importance: 'high',
    measureKeys: ['US.CPI.NSA.YOY'],
    scheduledAt, consensus: { displayValue: '—' }, providerPrevious: { displayValue: '+0.2%' },
    providerActual: { displayValue: '+0.3%' }, source: 'Narwhal',
    sourceObservedAt: '2026-03-01T00:00:00.000Z', coverage: 'observed-unverified'
  }
}

/** 3 月的一条真形状事件（读侧时区固定 Asia/Shanghai，UTC 13:30 是 21:30 同一天）。 */
const marchEvents: readonly MarketCalendarEvent[] = [dayEvent('cpi-mar', '3月CPI年率', '2026-03-11T13:30:00.000Z')]

/** 每次按月读都按月份答案例自己声明的那一份，其余月份空。 */
const readMarch = async (month: string): Promise<readonly unknown[] | null> => (month === '2026-03' ? marchEvents : [])

async function flush(): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) await act(async () => { await Promise.resolve() })
}

const monthTitle = (): string => document.body.querySelector('.mk-minical__h h3')?.textContent ?? 'X'
const detail = (): Element | null => document.body.querySelector('[data-calendar-detail-container]')

async function render(input: Readonly<{
  open?: boolean
  openTarget?: CalendarDrawerRequest
  now?: string
  onClose?: () => void
  readCalendarMonth?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
  /** 这一路的来源状态：停摆那句要靠它才出现在读者眼前。 */
  sources?: readonly Readonly<{ eventType: 'economic-indicator' | 'financial-event' | 'central-bank-activity'
    status: 'success'; sourceObservedAt: string; lastBatchAt?: string; collectorSilent?: boolean }>[]
}>): Promise<void> {
  if (host === undefined) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  const open = input.open ?? true
  const onClose = input.onClose ?? (() => undefined)
  const now = input.now ?? '2026-11-16T10:00:00.000Z'
  const readEvents = input.readCalendarMonth ?? readMarch
  // 读入口现在给整页（事件 + 来源状态）；这些用例只关心事件，包一层。
  const readCalendarMonth = async (month: string, asOf: string) => {
    const events = await readEvents(month, asOf)
    return events === null ? null : { events: events as never, sources: input.sources ?? [] }
  }
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <MacroIndicatorDrawer locale="zh-CN" open={open} onClose={onClose} onRetryPolicy={() => undefined}
        policyText={policyText} now={now} readCalendarMonth={readCalendarMonth}
        {...(input.openTarget === undefined ? {} : { openTarget: input.openTarget })} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  await flush()
}

describe('opening the calendar drawer at a target', () => {
  it('lands on the month the entry asked for, not on the previous read', async () => {
    // 抽屉默认落在「今天」那个月（2026-11）；入口给的是 3 月。
    await render({ openTarget: { seq: 1, month: '2026-03' } })
    expect(monthTitle()).toContain('2026 年 3 月')
  })

  it('opens the event detail the entry pointed at', async () => {
    await render({ openTarget: { seq: 1, month: '2026-03', eventKey: 'cpi-mar' } })
    expect(detail()?.textContent).toContain('3月CPI年率')
  })

  it('stays on the month when that month has no such event, and invents nothing', async () => {
    await render({ openTarget: { seq: 1, month: '2026-03', eventKey: 'not-in-this-month' } })
    expect(monthTitle()).toContain('2026 年 3 月')
    expect(detail()).toBeNull()
  })

  it('applies a request once: a later render does not drag the reader back', async () => {
    await render({ openTarget: { seq: 1, month: '2026-03' } })
    expect(monthTitle()).toContain('2026 年 3 月')
    // 读者自己往前翻一个月。
    const previous = document.body.querySelector<HTMLButtonElement>('button[aria-label="上一个月"]')!
    await act(async () => { previous.click() })
    await flush()
    expect(monthTitle()).toContain('2026 年 2 月')
    // 页面重渲染：同一个请求序号，换了一个对象身份，也**不许**再落一次。
    await render({ openTarget: { seq: 1, month: '2026-03' } })
    expect(monthTitle()).toContain('2026 年 2 月')
    // 新的请求序号才重新定位。
    await render({ openTarget: { seq: 2, month: '2026-03' } })
    expect(monthTitle()).toContain('2026 年 3 月')
  })

  it('drops the event detail when the whole drawer closes, so reopening starts clean', async () => {
    const onClose = (): void => undefined
    await render({ openTarget: { seq: 1, month: '2026-03', eventKey: 'cpi-mar' }, onClose })
    expect(detail()).not.toBeNull()
    // 点遮罩 = 关外层（受控开关在宿主，这里不外抛）。
    const mask = document.body.querySelector('.ant-drawer-mask') as HTMLElement
    await act(async () => { mask.click() })
    await flush()
    // 外层关了，内层详情不能还贴在整窗左缘。
    expect(detail()).toBeNull()

    await render({ open: false, openTarget: { seq: 1, month: '2026-03', eventKey: 'cpi-mar' } })
    await render({ openTarget: { seq: 2, month: '2026-03' } })
    expect(detail()).toBeNull()
    expect(monthTitle()).toContain('2026 年 3 月')
  })
})

/**
 * **「已停止出数」要真的出现在读者的抽屉里**（用户 2026-11-16 那个错数的善后）。
 *
 * 服务端算出了 per-feed 的出数状态（`02e5695`），但抽屉当时只拿到事件、拿不到来源状态，
 * 所以那句永远没地方落地。这一条钉的是**整条链**：月查询的 `sources` → 抽屉 → 事件详情的来源状态。
 */
it('shows the stopped-source line inside the drawer detail, from the month read', async () => {
  await render({
    openTarget: { seq: 1, month: '2026-03', eventKey: 'cpi-mar' },
    sources: [{
      eventType: 'economic-indicator', status: 'success', sourceObservedAt: '2026-03-01T00:00:00.000Z',
      lastBatchAt: '2026-03-01T00:00:00.000Z', collectorSilent: true
    }]
  })
  const status = document.body.querySelector('[data-market-source-status]')?.textContent ?? ''
  expect(status).toContain('已停止出数（最后 2026-03-01')
})
