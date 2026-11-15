import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

import type { JobHandler } from '@platform/jobs'

import { createEnabledZeroXRouterFeeds } from '../intelligence/macro-calendar/enabledCalendarFeeds'
import { narwhalSourceEventIdForIdentity } from '../intelligence/macro-calendar/marketCalendarMetricIdentity'
import { wireZeroXRouterCalendarSchedule } from './zeroXRouterCalendarSchedule'

/**
 * 0xrouter 三路日历的两件接线（2026-11-16）：
 * ① 调度器**真的被装配**——「设置里打开了」必须等于「作业注册了」，禁用必须 `removeSchedule`；
 * ② 采集成功后把观测转成标准行——不转，作业跑起来界面也是空的。
 *
 * 真库现场就是这两处都断：profile 全开、观测表停在 11-12、代码里调度器没有生产调用点。
 */

const feeds = {
  economicData: 'macro-calendar-0xrouter-economic-data',
  financialEvents: 'macro-calendar-0xrouter-financial-events',
  centralBank: 'macro-calendar-0xrouter-central-bank-activities'
} as const

function fakeJobRuntime() {
  const handlers = new Map<string, () => Promise<void>>()
  const scheduled: string[] = []
  const removed: string[] = []
  const enqueued: string[] = []
  return {
    handlers, scheduled, removed, enqueued,
    runtime: {
      registerHandler: (id: string, handler: JobHandler) => {
        handlers.set(id, () => handler({}, {} as never))
      },
      setSchedule: (definition: { id: string }) => { if (!scheduled.includes(definition.id)) scheduled.push(definition.id) },
      removeSchedule: (id: string) => { removed.push(id); const at = scheduled.indexOf(id); if (at >= 0) scheduled.splice(at, 1) },
      // 作业行本身与本用例无关（只关心「排了没有」），平台类型要求整个 JobRunRecord，这里按未验证处理。
      enqueueDefinition: async (definition: { id: string }) => { enqueued.push(definition.id); return { id: definition.id } as never }
    }
  }
}

/** 观测表只还原回填用到的列（列名与真表一致）。 */
function openDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec(`create table mi_macro_calendar_market_event_observations (
    source_event_id text not null, provider_id text not null, market_fact_key text,
    display_name text not null, country_code text, indicator_id text, event_kind text not null,
    scheduled_date text not null, scheduled_at text not null,
    consensus_json text, provider_previous_json text, provider_actual_json text,
    importance text not null, measure_keys_json text, last_seen_at text)`)
  database.prepare(`insert into mi_macro_calendar_market_event_observations
    (source_event_id, provider_id, market_fact_key, display_name, country_code, event_kind, scheduled_date,
     scheduled_at, provider_actual_json, importance, measure_keys_json, last_seen_at)
    values (?, 'narwhal', ?, 'cpi yoy', 'USA', 'economic-indicator', '2026-10-15', '2026-10-15T12:30:00.000Z',
      ?, 'high', '["x"]', '2026-11-14T00:00:00.000Z')`)
    .run('event-cpi-2026-10',
      JSON.stringify(['narwhal', 'macro-calendar-narwhal-economic-data', 'zh',
        JSON.parse(narwhalSourceEventIdForIdentity({ countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-10' }))]),
      JSON.stringify({ displayValue: '3.7' }))
  return database
}

const standardRowCount = (database: DatabaseSync) =>
  Number((database.prepare("select count(*) n from sqlite_master where name = 'mi_calendar_events'").get() as { n: number }).n) === 0
    ? 0
    : Number((database.prepare('select count(*) n from mi_calendar_events').get() as { n: number }).n)

describe('0xrouter 三路日历调度接线', () => {
  it('启用几路就注册几个定义；关掉一路再对账，该定义从日程里消失且不再采集', async () => {
    const jobs = fakeJobRuntime()
    let enabledFeeds: string[] = [feeds.economicData, feeds.financialEvents]
    const refreshAutomatic = vi.fn(async () => ({ state: 'succeeded', items: [] }))
    const schedule = wireZeroXRouterCalendarSchedule({
      jobRuntime: jobs.runtime, database: new DatabaseSync(':memory:'),
      refreshAutomatic, readReadiness: async () => ({ enabled: true, hasCredential: true }),
      readEnabledFeeds: () => enabledFeeds, startImmediately: false
    })
    await schedule.initialize()
    expect(jobs.scheduled.sort()).toEqual([
      'market-intelligence.refreshMarketCalendar.automatic.economic-data',
      'market-intelligence.refreshMarketCalendar.automatic.financial-events'
    ])
    // 启用即排一次启动运行（读者打开开关不用等下一个 30 分钟）。
    expect(jobs.enqueued.filter((id) => id.includes('economic-data')).length).toBeGreaterThan(0)

    enabledFeeds = [feeds.economicData]
    await schedule.syncSchedule()
    expect(jobs.removed).toContain('market-intelligence.refreshMarketCalendar.automatic.financial-events')
    expect(jobs.scheduled).toEqual(['market-intelligence.refreshMarketCalendar.automatic.economic-data'])

    // 被禁掉那一路的 handler 就算被调用也不许采集。
    const financialHandler = [...jobs.handlers.entries()].find(([id]) => id.includes('financial-events'))?.[1]
    expect(financialHandler).toBeDefined()
    await financialHandler!()
    expect(refreshAutomatic).not.toHaveBeenCalled()

    // 仍启用的那一路照常采集。
    const economicHandler = [...jobs.handlers.entries()].find(([id]) => id.includes('economic-data'))?.[1]
    await economicHandler!()
    expect(refreshAutomatic).toHaveBeenCalledWith([feeds.economicData])
    schedule.dispose()
  })

  it('装配层喂的是 0xrouter 自己的启用读取器：档案里启用的三路都必须注册（接错读取器就不注册）', async () => {
    const jobs = fakeJobRuntime()
    // 真读取器 + 真档案形状：三路都启用，而它们**不在**通用自动采集名单里。
    const readEnabledFeeds = createEnabledZeroXRouterFeeds({
      listProfiles: async () => Object.values(feeds).map((sourceId) => ({ sourceId, enabled: true }))
    })
    const schedule = wireZeroXRouterCalendarSchedule({
      jobRuntime: jobs.runtime, database: new DatabaseSync(':memory:'),
      refreshAutomatic: async () => ({ state: 'succeeded', items: [] }),
      readReadiness: async () => ({ enabled: true, hasCredential: true }),
      readEnabledFeeds, startImmediately: false
    })
    await schedule.initialize()
    expect(jobs.scheduled.sort()).toEqual([
      'market-intelligence.refreshMarketCalendar.automatic.central-bank-activities',
      'market-intelligence.refreshMarketCalendar.automatic.economic-data',
      'market-intelligence.refreshMarketCalendar.automatic.financial-events'
    ])
    schedule.dispose()
  })

  it('采集成功 → 把观测转成标准行；全都不成功就不转', async () => {
    const jobs = fakeJobRuntime()
    const database = openDatabase()
    let refreshState = 'succeeded'
    const refreshAutomatic = async () => refreshState === 'succeeded'
      ? { state: 'succeeded' as const, items: [{ state: 'succeeded', storedRows: 1 }] }
      : { state: 'unavailable' as const, failureCode: 'storage-unavailable', items: [{ state: 'unavailable' }] }

    const logs: { event: string; fields?: Record<string, unknown> }[] = []
    const schedule = wireZeroXRouterCalendarSchedule({
      jobRuntime: jobs.runtime, database, refreshAutomatic,
      readReadiness: async () => ({ enabled: true, hasCredential: true }),
      readEnabledFeeds: () => [feeds.economicData],
      // 用例里观测行按 narwhal 的形状造（回填那侧已覆盖两种来源的解码）。
      observationProviderId: 'narwhal',
      log: (_level, event, fields) => { logs.push({ event, fields }) },
      startImmediately: false
    })
    await schedule.initialize()
    const handler = [...jobs.handlers.entries()].find(([id]) => id.includes('economic-data'))![1]

    await handler()
    expect(standardRowCount(database)).toBe(1)
    expect(logs.at(-1)?.event).toBe('macro-calendar.zero-xrouter-standard-rows')
    expect(logs.at(-1)?.fields?.releases).toBe(1)

    // 断网那一轮：调度器把失败判成作业失败（`last_error` 里要能读出原因），且不转、不写。
    refreshState = 'unavailable'
    await expect(handler()).rejects.toThrow(/did not complete/)
    expect(logs.filter((entry) => entry.event === 'macro-calendar.zero-xrouter-standard-rows')).toHaveLength(1)
    schedule.dispose()
  })
})