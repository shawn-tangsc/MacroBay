import { describe, expect, it } from 'vitest'

import {
  calendarEventInterpretationDefinition, registerCalendarEventInterpretationBackfill
} from './calendarEventInterpretationBackfillJob'
import type { MacroCalendarRepository } from '../macroCalendarRepository'
import type { MacroCalendarRevision } from '../macroCalendarContracts'

/**
 * 高档补生成作业（R36 #34 第二半的「自动」那半）。
 *
 * 判据只有三个：**只挑高档已发布有值的行**、**已经有解读的不再花调用**、**一轮有上限**。
 * 作业本身不调模型——它把工作交给解读服务，所以这里数的是「几次 backfill」，模型调用由生成器用例钉。
 */
const now = '2026-11-25T03:00:00.000Z'

function revision(over: Partial<MacroCalendarRevision> & { eventKey: string }): MacroCalendarRevision {
  const { eventKey, ...rest } = over
  return {
    revisionId: `r-${eventKey}`, eventKey, releaseGroupKey: 'g', eventFamily: 'cpi',
    eventNameKey: 'cpi', countryCode: 'US', periodKey: '2026-M10', lifecycleState: 'released',
    revisionKind: 'official-release', scheduledDate: '2026-11-13', detectedAt: now, recordedAt: now,
    providerId: 'macro-calendar-bls', descriptorId: 'd', sourceUrl: 'u', evidenceHash: 'e', evidenceRefs: [],
    snapshotHash: 's', parserVersion: 'v', caveats: [], actual: { displayValue: '3.2%', unit: 'percent' },
    ...rest
  } as MacroCalendarRevision
}

function harness(rows: readonly MacroCalendarRevision[], overrides: Readonly<{
  read?: (input: { eventKey: string; locale: 'zh-CN' | 'en-US' }) => { state: string }
  backfill?: (input: { eventKey: string }) => Promise<{ state: string }>
  batchSize?: number
}> = {}) {
  const backfilled: string[] = []
  const repository = {
    listEffectiveMonthAsOf: () => [...rows]
  } as unknown as Pick<MacroCalendarRepository, 'listEffectiveMonthAsOf'>
  const schedules: unknown[] = []
  const handlers = new Map<string, () => Promise<void>>()
  const job = registerCalendarEventInterpretationBackfill(
    { registerHandler: (id, handler) => { handlers.set(id, () => handler(undefined, undefined as never)) }, setSchedule: (definition) => { schedules.push(definition) } },
    {
      repository, now: () => now, readLocale: async () => 'zh-CN', ...(overrides.batchSize === undefined ? {} : { batchSize: overrides.batchSize }),
      interpretation: {
        read: (input) => (overrides.read?.(input) ?? { state: 'absent' }) as never,
        backfill: async (input) => {
          backfilled.push(input.eventKey)
          return (overrides.backfill?.(input) ?? { state: 'ready' }) as never
        }
      }
    }
  )
  return { runOnce: job.runOnce, backfilled, schedules, handlers }
}

describe('calendarEventInterpretationBackfill: 只补高档', () => {
  it('只挑已发布、有实际值、判成高档的事件；中档与低档不进来', async () => {
    const h = harness([
      revision({ eventKey: 'high-1', importanceGrade: 'high' }),
      revision({ eventKey: 'medium-1', importanceGrade: 'medium' }),
      revision({ eventKey: 'low-1', importanceGrade: 'low' }),
      revision({ eventKey: 'ungraded-1' }),
      revision({ eventKey: 'not-released', importanceGrade: 'high', lifecycleState: 'scheduled', actual: undefined }),
      revision({ eventKey: 'no-value', importanceGrade: 'high', actual: undefined })
    ])
    const report = await h.runOnce()
    expect(h.backfilled).toEqual(['high-1'])
    expect(report).toEqual({ candidates: 1, generated: 1, skipped: 0 })
  })

  it('已经有这一份数据的解读：跳过，不再花模型调用', async () => {
    const h = harness([revision({ eventKey: 'high-1', importanceGrade: 'high' })], { read: () => ({ state: 'ready' }) })
    expect(await h.runOnce()).toEqual({ candidates: 1, generated: 0, skipped: 1 })
    expect(h.backfilled).toEqual([])
  })

  it('一轮有上限：超过上限的留到下一轮', async () => {
    const h = harness([
      revision({ eventKey: 'a', importanceGrade: 'high', scheduledDate: '2026-11-01' }),
      revision({ eventKey: 'b', importanceGrade: 'high', scheduledDate: '2026-11-02' }),
      revision({ eventKey: 'c', importanceGrade: 'high', scheduledDate: '2026-11-03' })
    ], { batchSize: 2 })
    expect(await h.runOnce()).toEqual({ candidates: 3, generated: 2, skipped: 0 })
    expect(h.backfilled).toEqual(['a', 'b'])
  })

  it('单条失败不拖垮整轮：其余照常，失败的那条只记跳过', async () => {
    const h = harness([
      revision({ eventKey: 'a', importanceGrade: 'high', scheduledDate: '2026-11-01' }),
      revision({ eventKey: 'b', importanceGrade: 'high', scheduledDate: '2026-11-02' })
    ], { backfill: async (input) => (input.eventKey === 'a' ? { state: 'failed' } : { state: 'ready' }) })
    expect(await h.runOnce()).toEqual({ candidates: 2, generated: 1, skipped: 1 })
  })

  it('作业定义双语、内部作业、按间隔跑；注册时就把排程挂上', () => {
    const h = harness([])
    expect(h.schedules).toEqual([calendarEventInterpretationDefinition()])
    const definition = calendarEventInterpretationDefinition() as {
      title: Record<string, string>; audience: string; trigger: { kind: string; intervalMs: number }
    }
    expect(definition.title['zh-CN']).not.toBe('')
    expect(definition.title['en-US']).not.toBe('')
    expect(definition.audience).toBe('internal')
    expect(definition.trigger).toEqual({ kind: 'interval', intervalMs: 600_000, anchor: 'lastComplete' })
  })
})