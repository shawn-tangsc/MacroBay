import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { runBriefingRegenerate } from './runBriefingRegenerate'

const document = { edition: { date: '2026-11-02' } } as unknown as DailyBriefingDocument

describe('manual briefing regeneration', () => {
  it('returns the document the run produced', async () => {
    const regenerate = vi.fn(async () => ({ state: 'available' as const, document }))

    const outcome = await runBriefingRegenerate({ client: { regenerate }, timeZone: 'Asia/Shanghai', locale: 'zh-CN' })

    expect(regenerate).toHaveBeenCalledWith({ locale: 'zh-CN', timeZone: 'Asia/Shanghai' })
    expect(outcome).toEqual({ kind: 'available', document })
  })

  it('keeps the service failure code and its stage trace', async () => {
    const regenerate = vi.fn(async () => ({ state: 'unavailable' as const, failureCode: 'editorial-timeout' }))

    const outcome = await runBriefingRegenerate({ client: { regenerate }, timeZone: 'UTC', locale: 'en-US' })

    expect(outcome.kind).toBe('failed')
    if (outcome.kind === 'failed') expect(outcome.failure).toEqual({ code: 'editorial-timeout' })
  })

  it('turns a thrown call into a failure without a code, not into a document', async () => {
    const regenerate = vi.fn(async () => { throw new Error('ipc-down') })

    const outcome = await runBriefingRegenerate({ client: { regenerate }, timeZone: 'UTC', locale: 'zh-CN' })

    expect(outcome).toEqual({ kind: 'failed', failure: {} })
  })
})

describe('a re-run of the edition on screen', () => {
  it('carries that edition\'s own cutoff and window, so no default period can stand in', async () => {
    const regenerate = vi.fn(async () => ({ state: 'available' as const, document }))

    await runBriefingRegenerate({
      client: { regenerate }, timeZone: 'Asia/Shanghai', locale: 'zh-CN', periodId: 'manual-0800',
      rerun: { periodTime: '2026-11-05T00:00:00.000Z', windowHours: 12 }
    })

    // 四样一起到服务端：期号、截止、窗口、语言。少任何一样，服务端就只剩"默认期配置"可回落。
    expect(regenerate).toHaveBeenCalledWith({
      locale: 'zh-CN', timeZone: 'Asia/Shanghai', periodId: 'manual-0800',
      rerun: { periodTime: '2026-11-05T00:00:00.000Z', windowHours: 12 }
    })
  })
})
