import { describe, expect, it } from 'vitest'

import { parseSourceNumber, createMacroIndicatorReadService } from './macroIndicatorReadService'
import { createMacroCalendarRepository } from './macroCalendarRepository'
import { createMarketCalendarEventRepository } from './0xrouter-calendar/marketCalendarEventRepository'
import { createMacroCalendarSqlite } from './macroCalendarSqlite'
import type { NarwhalReleaseRow } from './narwhalReleaseContracts'

/**
 * 判据用**真库今天的那几条数**钉住（2026-11-13 实测）：
 * - CPI 2026-10 的年率本期两源都空、上一期 3.7%；3.7 是**上一期**，不许挂到本期主位；
 * - 非农本期 165、发布当时上期 29（来源修订成 60，不许换着用）→ 较上期 +136K；
 * - 核心 PCE 本月没有发布行 → 「本月未发布」。
 */

const asOf = '2026-11-13T10:00:00.000Z'

const cpiRelease: NarwhalReleaseRow = {
  releaseId: 'cpi-2026-11-10', providerId: 'narwhal', countryCode: 'US',
  scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', dateBasis: 'exact', status: 'published',
  values: [
    { measure: 'core_cpi_mom', unit: 'percent', transformation: 'month_over_month', previous: '0.3', consensus: '0.2', actual: '0.3' },
    { measure: 'cpi_mom', unit: 'percent', transformation: 'month_over_month', previous: '0.6', consensus: '0.3', actual: '0.4' },
    // 这两条是这一期**没有** actual 的：结构性缺失，不是我们没采到。
    { measure: 'core_cpi_yoy', concept: 'core_cpi', unit: 'percent', transformation: 'year_over_year', previous: '2.6', consensus: '2.8' },
    { measure: 'cpi_yoy', concept: 'cpi', unit: 'percent', transformation: 'year_over_year', previous: '3.7', consensus: '3.9' }
  ],
  detectedAt: '2026-11-13T09:45:00.000Z', recordedAt: '2026-11-13T09:45:00.000Z'
}

const payrollRelease: NarwhalReleaseRow = {
  releaseId: 'payrolls-2026-11-06', providerId: 'narwhal', countryCode: 'US',
  scheduledDate: '2026-11-06', scheduledAt: '2026-11-06T13:30:00.000Z', dateBasis: 'exact', status: 'published',
  values: [
    // 新源自己给的 `previous` 是**修订后**的 60；卡上要发布当时的 29，见下面旧源那一行。
    { measure: 'nonfarm_payrolls_change', concept: 'payrolls', unit: 'thousands', transformation: 'change', previous: '60', consensus: '65', actual: '165' },
    { measure: 'unemployment_rate', unit: 'percent', transformation: 'rate', previous: '4.2', actual: '4.1' }
  ],
  detectedAt: '2026-11-13T09:45:00.000Z', recordedAt: '2026-11-13T09:45:00.000Z'
}

type LegacySeed = Readonly<{
  indicatorId: string
  scheduledDate: string
  scheduledAt: string
  actual?: string
  previous?: string
  locale?: string
}>

async function withRepository(run: (input: Readonly<{
  repository: ReturnType<typeof createMacroCalendarRepository>
  seedLegacy: (row: LegacySeed) => void
}>) => Promise<void> | void): Promise<void> {
  const storage = createMacroCalendarSqlite(':memory:')
  try {
    const repository = createMacroCalendarRepository({ storage })
    // 观测表由旧源采集端建（生产里同一个连接上早就有这张表）；这里用同一个建表函数，不抄一份 schema。
    createMarketCalendarEventRepository({ database: storage.database })
    storage.database.prepare(`insert into mi_macro_calendar_market_event_collections
      (collection_id, provider_id, descriptor_id, locale, window_start, window_end, detected_at, recorded_at,
       raw_record_id, evidence_hash, parser_version, input_count, skipped_count, skip_reasons_json, status)
      values ('c', '0xrouter', 'd', 'zh', '2026-10-01', '2026-12-01', ?, ?, 'r', 'e', 'p', 0, 0, '[]', 'success')`)
      .run(asOf, asOf)
    await run({
      repository,
      seedLegacy(row) {
        // 观测表没有写入 API（写入口归采集端），这条用例只需要读查询看到的那几列。
        storage.database.prepare(`insert into mi_macro_calendar_market_event_observations
          (observation_id, collection_id, provider_id, descriptor_id, locale, source_event_id, identity_state,
           market_fact_key, indicator_id, event_kind, display_name, country_code, importance, scheduled_date,
           scheduled_at, provider_actual_json, provider_previous_json, business_snapshot_hash, caveats_json,
           schema_version, candidate_key)
          values (?, 'c', '0xrouter', 'd', ?, 's', 'unverified', 'fact', ?, 'economic-indicator', ?, 'US', 'high', ?, ?, ?, ?, 'h', '[]', 1, ?)`)
          .run(`${row.indicatorId}-${row.scheduledAt}-${row.locale ?? 'zh'}`, row.locale ?? 'zh', row.indicatorId,
            `row ${row.indicatorId}`, row.scheduledDate, row.scheduledAt,
            row.actual === undefined ? null : JSON.stringify({ displayValue: row.actual }),
            row.previous === undefined ? null : JSON.stringify({ displayValue: row.previous }),
            `${row.indicatorId}-${row.scheduledAt}-${row.locale ?? 'zh'}`)
      }
    })
  } finally { storage.close() }
}

type Fact = Awaited<ReturnType<ReturnType<typeof createMacroIndicatorReadService>['read']>>[number]
const factsOf = async (facts: Promise<readonly Fact[]>) =>
  Object.fromEntries((await facts).map((fact) => [fact.metricKey, fact])) as Record<string, Fact>

describe('macroIndicatorReadService', () => {
  it('keeps the structurally absent CPI year-over-year value out of the main slot and carries last period', async () => {
    await withRepository(async ({ repository, seedLegacy }) => {
      repository.upsertReleaseRow(cpiRelease)
      seedLegacy({ indicatorId: '8637', scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', previous: '3.7%' })
      seedLegacy({ indicatorId: '8639', scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', previous: '2.6%' })

      const cpi = (await factsOf(createMacroIndicatorReadService(repository).read({ asOf })))['US.CPI.NSA.YOY']!

      expect(cpi).toMatchObject({ state: 'missing-current', period: '2026-10', previousAsPublished: 3.7 })
      // 3.7 是上一期，不许写成这一期的值——那正是「数字倒退」的来源。
      expect(cpi.value).toBeUndefined()
    })
  })

  it('reports payrolls from the new source and computes the gap against the as-published previous', async () => {
    await withRepository(async ({ repository, seedLegacy }) => {
      repository.upsertReleaseRow(payrollRelease)
      // 旧源这一行是**发布当时**抓的：上期 29。新源记录的是修订后的 60。
      seedLegacy({ indicatorId: '8656', scheduledDate: '2026-11-06', scheduledAt: '2026-11-06T13:30:00.000Z', actual: '165', previous: '29' })

      const payrolls = (await factsOf(createMacroIndicatorReadService(repository).read({ asOf })))['US.NONFARM.SA.CHANGE']!

      expect(payrolls).toMatchObject({ state: 'provided', source: 'narwhal', value: 165, previousAsPublished: 29, unit: 'thousands' })
      expect(payrolls.value! - payrolls.previousAsPublished!).toBe(136)
    })
  })

  it('never borrows an older period value for the current period', async () => {
    await withRepository(async ({ repository, seedLegacy }) => {
      // 本期（11-10）发布行没有年率值；上一期（10-14）有 3.7%。
      repository.upsertReleaseRow(cpiRelease)
      seedLegacy({ indicatorId: '8637', scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', previous: '3.7%' })
      seedLegacy({ indicatorId: '8637', scheduledDate: '2026-10-14', scheduledAt: '2026-10-14T12:30:00.000Z', actual: '3.7%', previous: '3.4%' })

      const cpi = (await factsOf(createMacroIndicatorReadService(repository).read({ asOf })))['US.CPI.NSA.YOY']!

      expect(cpi.state).toBe('missing-current')
      expect(cpi.value).toBeUndefined()
    })
  })

  it('says 未发布 for 核心 PCE, which has no release row at all this month', async () => {
    await withRepository(async ({ repository }) => {
      repository.upsertReleaseRow(cpiRelease)
      expect((await factsOf(createMacroIndicatorReadService(repository).read({ asOf })))['US.CORE_PCE.NSA.YOY'])
        .toMatchObject({ state: 'not-recorded' })
    })
  })

  it('falls back to the legacy source when the new one has no value for the measure', async () => {
    await withRepository(async ({ repository, seedLegacy }) => {
      repository.upsertReleaseRow(cpiRelease)
      // 旧源同一天那一行有值（构造出来的情形）：主身份就是这个指标，所以可以用。
      seedLegacy({ indicatorId: '8637', scheduledDate: '2026-11-10', scheduledAt: '2026-11-10T13:30:00.000Z', actual: '3.7%', previous: '3.4%' })

      expect((await factsOf(createMacroIndicatorReadService(repository).read({ asOf })))['US.CPI.NSA.YOY'])
        .toMatchObject({ state: 'provided', source: '0xrouter', value: 3.7, unit: 'percent' })
    })
  })

  it('refuses a non-canonical as-of instead of reporting every card as 未发布', async () => {
    await withRepository(async ({ repository }) => {
      await expect(createMacroIndicatorReadService(repository).read({ asOf: '2026-11-13' })).rejects.toThrow()
    })
  })

  /**
   * 下一期共识：盘口是**下一期**的盘（非农 11 月：成交 $5,285、中位数落 100–125K 档 ≈ 11 万）。
   * 它不能塞进本期那一格——本期那一格是 10 月的实际（165）与 10 月的预期（65）。
   */
  it('attaches the next release and its market consensus, keeping it apart from this period', async () => {
    await withRepository(async ({ repository }) => {
      repository.upsertReleaseRow(payrollRelease)
      const read = createMacroIndicatorReadService(repository, {
        nextReleaseFor: (metricKey) => metricKey === 'US.NONFARM.SA.CHANGE'
          ? { period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z' }
          : undefined,
        readMarketConsensus: async () => ({ state: 'ok', value: 112.5, marketVolume: 5285, asOf: '2026-11-13T20:40:00.000Z' })
      }).read({ asOf })

      const payrolls = (await factsOf(read))['US.NONFARM.SA.CHANGE']!

      // 本期那一格没被下一期的盘污染。
      expect(payrolls).toMatchObject({ state: 'provided', value: 165 })
      expect(payrolls.consensus).toBeUndefined()
      expect(payrolls.next).toEqual({
        period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z',
        consensus: { value: 112.5, provenance: 'market-implied', asOf: '2026-11-13T20:40:00.000Z', marketVolume: 5285 }
      })
    })
  })

  it('tells a missing market apart from a failed read', async () => {
    await withRepository(async ({ repository }) => {
      repository.upsertReleaseRow(payrollRelease)
      const service = (consensus: NonNullable<Parameters<typeof createMacroIndicatorReadService>[1]>['readMarketConsensus']) =>
        createMacroIndicatorReadService(repository, {
          nextReleaseFor: () => ({ period: '2026-11', releaseAt: '2026-12-04T13:30:00.000Z' }),
          readMarketConsensus: consensus
        }).read({ asOf })

      // 两次读都要在同一个同步前缀里发起：夹具的连接在 `run` 返回时就关了。
      const missing = service(async () => ({ state: 'unavailable', reason: 'no-market' }))
      const failed = service(async () => { throw new Error('network') })
      const [noMarket, unreadable] = await Promise.all([factsOf(missing), factsOf(failed)])

      expect(noMarket['US.NONFARM.SA.CHANGE']!.next).toMatchObject({ consensusState: 'no-market' })
      expect(unreadable['US.NONFARM.SA.CHANGE']!.next).toMatchObject({ consensusState: 'unreadable' })
    })
  })

  /** 没有排期就不带「下一期」：拿上一期凑会让盘口去查一个不存在的盘。 */
  it('carries no next release when the calendar has no schedule', async () => {
    await withRepository(async ({ repository }) => {
      repository.upsertReleaseRow(payrollRelease)
      const read = createMacroIndicatorReadService(repository, {
        nextReleaseFor: () => undefined,
        readMarketConsensus: async () => ({ state: 'ok', value: 112.5, marketVolume: 5285, asOf: '2026-11-13T20:40:00.000Z' })
      }).read({ asOf })
      expect((await factsOf(read))['US.NONFARM.SA.CHANGE']!.next).toBeUndefined()
    })
  })
})

describe('parseSourceNumber', () => {
  it.each([
    ['165', 165], ['+29K', 29], ['3.7%', 3.7], ['-18', -18], ['0.3', 0.3], ['1.2%', 1.2]
  ])('reads %s from the source text', (display, expected) => {
    expect(parseSourceNumber(display)).toBe(expected)
  })

  it.each([undefined, '', '—', 'n/a', '1.2B'])('returns undefined for %s instead of 0', (display) => {
    expect(parseSourceNumber(display)).toBeUndefined()
  })
})
