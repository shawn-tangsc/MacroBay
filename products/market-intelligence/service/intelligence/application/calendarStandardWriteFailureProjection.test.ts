import { describe, expect, it } from 'vitest'

import { readStandardWriteFailures, writeFailureStateOf } from './calendarStandardWriteReader'
import { settingsView } from './sourceProjection'

/**
 * 整页口径的五条（用户 2026-11-19 派）：写入层 → 设置页视图。
 *
 * 第 1 条是这条线存在的理由——**写库失败不许被显示成「正常」**，而「正常」恰恰是
 * 只看 `healthState` 时最容易得出的结论（采集成功、值有、只是没写进表）。
 * 所以这里断的不是「字段透传了」，而是：失败在、`healthState` 仍是它自己那一列的值、
 * 两列各说各的。
 */
const routerFeed = 'macro-calendar-0xrouter-economic-data'

function viewWith(records: Record<string, unknown>) {
  const state = readStandardWriteFailures({ get: (writerId) => records[writerId] as never })
  const never: Record<string, 'never-written'> = {}
  const unreadable: Record<string, 'unreadable'> = {}
  for (const sourceId of Object.keys(state.neverWritten)) never[sourceId] = 'never-written'
  for (const sourceId of Object.keys(state.unreadable)) unreadable[sourceId] = 'unreadable'
  return settingsView({
    enabledById: { [routerFeed]: true },
    healthById: { [routerFeed]: { runtimeStatus: 'healthy', consecutiveFailures: 0 } },
    jobRegisteredById: {},
    knownSourceIds: new Set([routerFeed]),
    writeFailureById: state.failures,
    writeFailureStateById: { ...never, ...unreadable }
  } as never)
}

function rowOf(view: ReturnType<typeof settingsView>) {
  return view.groups.flatMap((group) => group.providers).flatMap((provider) => provider.sources)
    .find((source) => source.sourceId === routerFeed)!
}

describe('写库失败进设置页：五条', () => {
  it('① 造一次写库失败 → 该源出现失败码，但 healthState 仍是它自己的值（不被拉成 failed）', () => {
    const row = rowOf(viewWith({
      '0xrouter': { updatedAt: '2026-11-19T12:10:00.000Z', lastFailure: { at: '2026-11-19T12:10:00.000Z', failedRows: 4, firstErrorCode: 'standard-write-failed' } }
    }))
    expect(row.writeFailure).toEqual({ at: '2026-11-19T12:10:00.000Z', code: 'standard-write-failed' })
    expect(row.healthState).toBe('healthy')
    expect(row.writeFailureState).toBeUndefined()
  })

  it('② 还没写过 → never-written（空态），不是「没失败」', () => {
    const row = rowOf(viewWith({}))
    expect(row.writeFailureState).toBe('never-written')
    expect(row.writeFailure).toBeUndefined()
  })

  it('③ 读不到 → unreadable（错误态 + 重试），不落「没失败」', () => {
    const state = readStandardWriteFailures({ get: () => { throw new Error('store-unreadable') } })
    expect(writeFailureStateOf(state, routerFeed).kind).toBe('unreadable')
  })

  it('④ 有记录、没失败 → 两个字段都不出现（这一列没有「健康」这个评价）', () => {
    const row = rowOf(viewWith({
      '0xrouter': { updatedAt: '2026-11-19T12:00:00.000Z', lastSuccessAt: '2026-11-19T12:00:00.000Z' }
    }))
    expect('writeFailure' in row).toBe(false)
    expect('writeFailureState' in row).toBe(false)
  })

  it('⑤ 历史回放（internal）失败不挂到任何源', () => {
    const row = rowOf(viewWith({
      'macro-calendar-official-replay': { updatedAt: '2026-11-19T12:10:00.000Z', lastFailure: { at: '2026-11-19T12:10:00.000Z', failedRows: 9, firstErrorCode: 'standard-write-failed' } }
    }))
    expect(row.writeFailure).toBeUndefined()
  })
})
