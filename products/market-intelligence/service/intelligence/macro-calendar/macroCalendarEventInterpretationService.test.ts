import { describe, expect, it, vi } from 'vitest'

import type { MacroCalendarRepository } from './macroCalendarRepository'
import type { MacroCalendarRevision } from './macroCalendarContracts'
import { createMacroCalendarInterpretationService } from './macroCalendarEventInterpretationService'

/**
 * 解读服务的档/值门控（产品 2026-11-25 成本护栏）。
 *
 * 两条都必须在**服务侧**成立，不能只在界面：
 * - 没有实际值不生成——没发布就没有「这次偏了多少」可讲，调模型只会写出一段「尚未公布」；
 * - 低档与未分级不生成（由生成器的档门控保证，这里确认服务没有绕开它去伪造结果）。
 */
const now = '2026-11-13T14:00:00.000Z'

function revision(over: Partial<MacroCalendarRevision> = {}): MacroCalendarRevision {
  return {
    revisionId: 'r-1', eventKey: 'US.CPI.RELEASE.2026-M10', releaseGroupKey: 'g', eventFamily: 'consumer-price-index',
    eventNameKey: 'cpi', countryCode: 'US', importanceGrade: 'high', periodKey: '2026-M10', lifecycleState: 'released',
    revisionKind: 'official-release', scheduledDate: '2026-11-13', scheduledAt: '2026-11-13T13:30:00.000Z',
    detectedAt: now, recordedAt: now, providerId: 'macro-calendar-bls', descriptorId: 'd', sourceUrl: 'u',
    evidenceHash: 'e', evidenceRefs: [], snapshotHash: 's', parserVersion: 'v', caveats: [],
    actual: { displayValue: '3.2%' }, previous: { displayValue: '3.0%' },
    ...over
  } as MacroCalendarRevision
}

function service(rows: Partial<MacroCalendarRevision> = {}) {
  const generate = vi.fn(async (_input: unknown) => ({ state: 'ready' as const, text: 't', generatedAt: now, snapshotHash: 'h', evidenceScope: ['event'], cached: false }))
  const repository = {
    getEffectiveEventAsOf: () => revision(rows),
    listEffectiveMonthAsOf: () => []
  } as unknown as Pick<MacroCalendarRepository, 'getEffectiveEventAsOf' | 'listEffectiveMonthAsOf'>
  return {
    generate,
    service: createMacroCalendarInterpretationService({
      repository, database: undefined as never, now: () => now,
      generator: { generate } as never
    })
  }
}

describe('calendarEventInterpretationService: 没有实际值不生成', () => {
  it('未发布 / 实际值为空：请求返回 absent，一次模型调用都不发', async () => {
    for (const rows of [{ actual: undefined }, { actual: { displayValue: '   ' } }] as const) {
      const h = service(rows)
      expect(await h.service.request({ eventKey: 'US.CPI.RELEASE.2026-M10', locale: 'zh-CN' })).toEqual({ state: 'absent' })
      expect(h.service.read({ eventKey: 'US.CPI.RELEASE.2026-M10', locale: 'zh-CN' })).toEqual({ state: 'absent' })
      expect(h.generate).not.toHaveBeenCalled()
    }
  })

  it('有实际值才交给生成器，并把族与档带过去（计数要用）', async () => {
    const h = service()
    const result = await h.service.request({ eventKey: 'US.CPI.RELEASE.2026-M10', locale: 'zh-CN' })
    expect(result.state).toBe('ready')
    expect(h.generate).toHaveBeenCalledTimes(1)
    const input = h.generate.mock.calls[0]![0] as unknown as { family: string; importance: string; trigger: string }
    expect(input.family).toBe('CPI')
    expect(input.importance).toBe('high')
    expect(input.trigger).toBe('request')
  })

  it('高档后台补生成走 auto：同一份数据不再请求（读侧先说 ready）', async () => {
    const h = service()
    await h.service.backfill({ eventKey: 'US.CPI.RELEASE.2026-M10', locale: 'zh-CN' })
    expect((h.generate.mock.calls[0]![0] as unknown as { trigger: string }).trigger).toBe('auto')
  })
})