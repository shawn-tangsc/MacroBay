// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { IndicatorCards, type IndicatorCardGroup } from './IndicatorCards'
import { macroIndicatorDrawerText } from './macroIndicatorDrawerText'
import { productText } from '../../shared/i18n/productText'
import type { MacroIndicatorCardFact } from '../../../service/intelligence/macro-calendar/macroIndicatorCardFacts'

/**
 * 三张卡「这一格没有数」的三种状态**不许互相冒充**（用户 2026-11-14 报「三张卡一转眼全空了」）：
 *
 * - 还没读完（`facts` 缺席）→ 等待态，不写任何结论；
 * - 整次读取失败（`unreadable`）→ 「暂时读不到」；
 * - 读到了、这一期确实没盘 → 「本期暂无预期（盘未开）」。
 *
 * 之前四行全缺一律画成最后那句：市场明明开着，卡上说「盘未开」。这一屏是那句错的唯一判据。
 */
const text = macroIndicatorDrawerText['zh-CN']
const calendarText = productText['zh-CN'].pages.intelligence.portal.calendar

const groups: readonly IndicatorCardGroup[] = [
  {
    id: 'cpi',
    title: 'CPI 年率',
    rows: [
      { metricKey: 'US.CPI.NSA.YOY', label: text.cardRows.yoy, kind: 'yoy' },
      { metricKey: 'US.CPI.SA.MOM', label: text.cardRows.mom, kind: 'mom' }
    ]
  }
]

const releaseAt = '2026-12-10T13:30:00.000Z'

/** 两行都排上了下一期，但都没有预期：这是「确实没盘」那一档。 */
const closedMarket: readonly MacroIndicatorCardFact[] = [
  { metricKey: 'US.CPI.NSA.YOY', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 3.7, unit: 'percent', next: { period: '2026-11', releaseAt, timePrecision: 'minute', expectedState: 'no-market' } },
  { metricKey: 'US.CPI.SA.MOM', state: 'missing-current', period: '2026-10', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 0.1, unit: 'percent', next: { period: '2026-11', releaseAt, timePrecision: 'minute', expectedState: 'no-market' } }
]

/** 同样没有预期，但原因是**读失败**：不许画成「盘未开」。 */
const unreadableRow: readonly MacroIndicatorCardFact[] = [
  closedMarket[0]!,
  { ...closedMarket[1]!, next: { period: '2026-11', releaseAt, timePrecision: 'minute' as const, expectedState: 'unreadable' as const } }
]

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
})

async function renderCards(input: Readonly<{
  facts?: readonly MacroIndicatorCardFact[]
  unreadable?: boolean
}>): Promise<string> {
  await act(async () => {
    root!.render(<ShellLanguageProvider language="zh-CN"><ShellTimeZoneProvider timeZone="Asia/Shanghai">
      <IndicatorCards groups={groups}
        {...(input.facts === undefined ? {} : { facts: input.facts })}
        {...(input.unreadable === true ? { unreadable: true } : {})}
        text={text} calendarText={calendarText} timeZone="Asia/Shanghai"
        now="2026-11-14T00:00:00.000Z" resolveKey={() => ''} />
    </ShellTimeZoneProvider></ShellLanguageProvider>)
  })
  return document.body.querySelector('[data-card="upcoming"]')?.textContent ?? ''
}

describe('card expectations: unreadable is not the same as no market', () => {
  it('says 暂时读不到 when the whole read failed, never 盘未开', async () => {
    const card = await renderCards({ unreadable: true })
    expect(card).toContain('暂时读不到')
    expect(card).not.toContain('盘未开')
  })

  it('keeps an unreadable row distinct from a row whose market is really closed', async () => {
    const card = await renderCards({ facts: unreadableRow })
    // 读不到的那一行写「暂时读不到」，另一行才是「暂无预期」；整页不折叠成一句「盘未开」。
    expect(card).toContain('暂时读不到')
    expect(card).toContain('暂无预期')
    expect(card).not.toContain('本期暂无预期（盘未开）')
  })

  it('still writes 盘未开 when the read succeeded and this period really has no market', async () => {
    const card = await renderCards({ facts: closedMarket })
    expect(card).toContain('本期暂无预期（盘未开）')
    expect(card).not.toContain('暂时读不到')
  })

  it('writes no verdict at all while the read is still in flight', async () => {
    const card = await renderCards({})
    expect(card).not.toContain('盘未开')
    expect(card).not.toContain('暂时读不到')
    // 等待态走统一的 LoadingState，不写「暂无」这类结论句。
    expect(document.body.querySelector('[class*="loading"]')).not.toBeNull()
  })
})
