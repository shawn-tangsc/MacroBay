import { describe, expect, it } from 'vitest'

import { computeSourceHealthDetail, type SourceHealthFacts } from './sourceHealthCells'

/**
 * B4 四格的判据全在这一层（纯函数）：只吃投影事实，不判健康档、不重算 enabled。
 * 每个分支用一份固定夹具钉死——`now` 由用例给，所以「今天」不会随跑的时间漂。
 */
const NOW = new Date('2026-11-10T05:30:00.000Z')
const TZ = 'Asia/Shanghai'

function facts(overrides: Partial<SourceHealthFacts> = {}): SourceHealthFacts {
  return {
    source: {
      enabled: true,
      collection: 'adapter',
      readiness: 'live',
      visibility: 'visible',
      capabilities: { runNow: 'adapter', testConnection: true }
    },
    now: NOW,
    timeZone: TZ,
    ...overrides
  }
}

describe('the four health cells read projected facts only', () => {
  it('says today has a reading, with the reader-local clock', () => {
    // 04:00Z 在东八区是 12:00，与 now（13:30 东八区）同一天。
    const view = computeSourceHealthDetail(facts({ health: { lastSuccessAt: '2026-11-10T04:00:00.000Z' } }))
    expect(view.today).toEqual({ kind: 'yes', time: '12:00' })
    expect(view.lastSuccess).toEqual({ kind: 'known', text: '11-10 12:00 GMT+8' })
    expect(view.idleReason).toBe('collecting')
  })

  it('says nothing yet today when the last success was an earlier day', () => {
    const view = computeSourceHealthDetail(facts({ health: { lastSuccessAt: '2026-11-09T04:00:00.000Z' } }))
    expect(view.today).toEqual({ kind: 'no' })
    expect(view.lastSuccess).toEqual({ kind: 'known', text: '11-09 12:00 GMT+8' })
  })

  it('separates "no successful run" from "this source keeps no run-by-run record"', () => {
    // 读到了健康读数、但没有成功记录 = 确实没有（never-ran）。
    expect(computeSourceHealthDetail(facts({ health: {} }))).toMatchObject({
      today: { kind: 'no' },
      lastSuccess: { kind: 'none' },
      idleReason: 'never-ran'
    })
    // 没读它（日历 feed 不在通用目录里）= 拿不到（unknown），不是「从没采过」。
    const skipped = computeSourceHealthDetail(facts({}))
    expect(skipped).toMatchObject({
      today: { kind: 'unknown' },
      lastSuccess: { kind: 'unknown' },
      idleReason: 'unknown'
    })
  })

  it('falls back to the declared last successful sync when no health reading exists', () => {
    const view = computeSourceHealthDetail(facts({
      source: {
        enabled: true,
        collection: 'provider',
        readiness: 'live',
        visibility: 'visible',
        capabilities: { runNow: 'provider', testConnection: true },
        unavailable: {
          reasonCode: 'official-endpoint-returned-403',
          automaticSync: 'stopped',
          lastSuccessfulSyncAt: '2026-11-09T04:00:00.000Z',
          decidedAt: '2026-11-08'
        }
      }
    }))
    expect(view.lastSuccess).toEqual({ kind: 'known', text: '11-09 12:00 GMT+8' })
    expect(view.today).toEqual({ kind: 'no' })
    expect(view.idleReason).toBe('unavailable')
  })

  it('words the idle reason from projected facts, in one fixed priority order', () => {
    const base = { health: {} } as const
    // 停用压过一切。
    expect(computeSourceHealthDetail(facts({
      ...base,
      source: { ...facts().source, enabled: false },
      credentialStatus: { hasCredential: false }
    })).idleReason).toBe('disabled')
    // 未接入压过凭据。
    expect(computeSourceHealthDetail(facts({
      ...base,
      source: { ...facts().source, readiness: 'planned' },
      credentialStatus: { hasCredential: false }
    })).idleReason).toBe('not-ready')
    // 取不到压过缺凭据。
    expect(computeSourceHealthDetail(facts({
      ...base,
      source: {
        ...facts().source,
        unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', decidedAt: '2026-11-08' }
      },
      credentialStatus: { hasCredential: false }
    })).idleReason).toBe('unavailable')
    expect(computeSourceHealthDetail(facts({ ...base, credentialStatus: { hasCredential: false } })).idleReason).toBe('missing-credential')
    expect(computeSourceHealthDetail(facts({ ...base, source: { ...facts().source, collection: 'none' } })).idleReason).toBe('product-owned')
    expect(computeSourceHealthDetail(facts({ ...base, profile: { collectionPreset: 'manual' } })).idleReason).toBe('manual')
  })

  it('answers "can it run now" with the same gate the service uses', () => {
    const runnable = { health: {} } as const
    expect(computeSourceHealthDetail(facts({ ...runnable, supportsRunNow: true })).runNow).toBe('yes')
    // 没有目录声明（日历 feed）：这里没有它的运行入口。
    expect(computeSourceHealthDetail(facts({ ...runnable })).runNow).toBe('unsupported')
    // 平台声明了不能跑（planned / fixture-ready 会被服务端拒）。
    expect(computeSourceHealthDetail(facts({ ...runnable, supportsRunNow: false })).runNow).toBe('unsupported')
    expect(computeSourceHealthDetail(facts({
      ...runnable,
      supportsRunNow: true,
      source: { ...facts().source, readiness: 'fixture-ready' }
    })).runNow).toBe('not-ready')
    expect(computeSourceHealthDetail(facts({
      ...runnable,
      supportsRunNow: true,
      source: {
        ...facts().source,
        unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', decidedAt: '2026-11-08' }
      }
    })).runNow).toBe('unavailable')
    expect(computeSourceHealthDetail(facts({
      ...runnable,
      supportsRunNow: true,
      credentialStatus: { hasCredential: false }
    })).runNow).toBe('missing-credential')
    expect(computeSourceHealthDetail(facts({
      ...runnable,
      supportsRunNow: true,
      source: { ...facts().source, enabled: false }
    })).runNow).toBe('disabled')
  })

  it('does not print an instant it cannot parse', () => {
    const view = computeSourceHealthDetail(facts({ health: { lastSuccessAt: 'not-a-time' } }))
    expect(view.lastSuccess).toEqual({ kind: 'none' })
    expect(view.today).toEqual({ kind: 'no' })
  })
})
