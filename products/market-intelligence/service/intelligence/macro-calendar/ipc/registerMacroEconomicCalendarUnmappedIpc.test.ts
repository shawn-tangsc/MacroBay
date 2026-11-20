import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, recordCalendarUnmapped } from '../marketCalendarStandardTable'
import { registerMacroEconomicCalendarIpc } from './registerMacroEconomicCalendarIpc'

/**
 * `intelligence.macro.marketCalendar.queryUnmappedMonth` 的形状（2026-11-16）。
 *
 * 两条判据只关于**契约形状**：
 * ① 读到了 → `state: 'available'` + `items`（**空数组也有意义**：那一月确实没有未映射行）；
 * ② 读不到/入参不对 → `state: 'unavailable'` + `reasonCode`，**绝不用空数组表达「读不到」**。
 */
const productId = 'market-intelligence'

function capture() {
  const handlers = new Map<string, (payload?: unknown) => Promise<unknown>>()
  return {
    handlers,
    register: (id: string, channel: string, handler: (payload?: unknown) => Promise<unknown>) => {
      handlers.set(`${id}/${channel}`, handler)
    }
  }
}

function databaseWithOneUnmapped(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  recordCalendarUnmapped(database, {
    providerId: '0xrouter', sourceKey: 'no-country-1', detectedAt: '2026-11-16T00:00:00.000Z',
    reason: 'missing-country',
    rawJson: JSON.stringify({ name: 'ECB speech', eventKind: 'central-bank-activity', scheduledDate: '2026-11-10' })
  })
  return database
}

function register(database?: DatabaseSync) {
  const { handlers, register: registrar } = capture()
  registerMacroEconomicCalendarIpc(
    registrar as never,
    { listEffectiveMonthAsOf: () => [], getEffectiveEventAsOf: () => undefined } as never,
    {} as never, undefined, undefined, undefined, undefined, undefined, undefined,
    database === undefined ? undefined : { database }
  )
  return handlers
}

describe('未映射观测的月读路由（仅渲染层）', () => {
  it('读到就给 available + items；那一月没有就返回空数组（空 ≠ 读不到）', async () => {
    const handlers = register(databaseWithOneUnmapped())
    const handler = handlers.get(`${productId}/intelligence.macro.marketCalendar.queryUnmappedMonth`)
    expect(handler).toBeDefined()
    const value = await handler!({ month: '2026-11', locale: 'zh-CN' })
    expect(value).toMatchObject({ state: 'available' })
    const items = (value as { items: readonly { title: string; reason: string }[] }).items
    expect(items.map((item) => item.title)).toEqual(['ECB speech'])
    expect(items[0]!.reason).toBe('missing-country')
    // 换一个月：没有未映射行，仍然是 available（读得到、只是没有）。
    expect(await handler!({ month: '2026-09' })).toMatchObject({ state: 'available', items: [] })
  })

  it('没有装配读口或入参不对 → unavailable + reasonCode，不用空数组冒充', async () => {
    const handlers = register(undefined)
    const handler = handlers.get(`${productId}/intelligence.macro.marketCalendar.queryUnmappedMonth`)!
    expect(await handler({ month: '2026-11' })).toEqual({ state: 'unavailable', reasonCode: 'query-unavailable' })
    const wired = register(databaseWithOneUnmapped())
    const wiredHandler = wired.get(`${productId}/intelligence.macro.marketCalendar.queryUnmappedMonth`)!
    expect(await wiredHandler({})).toEqual({ state: 'unavailable', reasonCode: 'query-unavailable' })
  })
})
