import { describe, expect, it, vi } from 'vitest'

import { readStandardWriteFailures, writeFailureStateOf, STANDARD_WRITER_SOURCES } from './calendarStandardWriteReader'
import type { CalendarStandardWriteLayer } from '../macro-calendar/calendarStandardWriteLayer'

/**
 * 「写库这一列」的四态（用户 2026-11-19）：读失败 / 还没写过 / 没失败 / 有当前失败。
 *
 * 四件事分不开就会出两种事故：把「还没写过」说成「没失败」（读者以为没事），或者把
 * `internal` 的历史回放失败说成「采到了没写进去」（日报误报并跳过补采）。
 */
function layerOf(records: Record<string, unknown>): Pick<CalendarStandardWriteLayer, 'get'> {
  return { get: (writerId) => records[writerId] as never }
}

const routerFeed = 'macro-calendar-0xrouter-central-bank-activities'
const narwhalFeed = 'macro-calendar-narwhal-economic-data'

describe('写入层 → 设置页的四态', () => {
  it('三路 0xRouter feed 共用同一个写入方：一次失败三行都读到', () => {
    const view = readStandardWriteFailures(layerOf({
      '0xrouter': { updatedAt: '2026-11-19T12:00:00.000Z', lastFailure: { at: '2026-11-19T12:00:00.000Z', failedRows: 3, firstErrorCode: 'standard-write-failed' } }
    }))
    for (const sourceId of ['macro-calendar-0xrouter-economic-data', 'macro-calendar-0xrouter-financial-events', routerFeed]) {
      expect(writeFailureStateOf(view, sourceId)).toEqual({
        kind: 'failed', failure: { at: '2026-11-19T12:00:00.000Z', code: 'standard-write-failed' }
      })
    }
  })

  it('没有记录 = 还没写过（空态），不是「没失败」', () => {
    const view = readStandardWriteFailures(layerOf({}))
    expect(writeFailureStateOf(view, narwhalFeed).kind).toBe('never-written')
    expect(writeFailureStateOf(view, routerFeed).kind).toBe('never-written')
  })

  it('有记录、没有当前失败 → 什么都不说（no-failure）', () => {
    const view = readStandardWriteFailures(layerOf({
      '0xrouter': { updatedAt: '2026-11-19T12:00:00.000Z', lastSuccessAt: '2026-11-19T12:00:00.000Z' }
    }))
    expect(writeFailureStateOf(view, routerFeed).kind).toBe('no-failure')
  })

  it('失败早于最后一次成功 = 已恢复，不算当前失败（判断只调写入层那一处）', () => {
    const view = readStandardWriteFailures(layerOf({
      '0xrouter': {
        updatedAt: '2026-11-19T13:00:00.000Z',
        lastSuccessAt: '2026-11-19T13:00:00.000Z',
        lastFailure: { at: '2026-11-19T12:00:00.000Z', failedRows: 1, firstErrorCode: 'standard-write-failed' }
      }
    }))
    expect(writeFailureStateOf(view, routerFeed).kind).toBe('no-failure')
  })

  it('读写入层抛错 = 读不到（错误态），不落「没失败」', () => {
    const view = readStandardWriteFailures({ get: vi.fn(() => { throw new Error('store-unreadable') }) })
    expect(writeFailureStateOf(view, routerFeed).kind).toBe('unreadable')
  })

  it('历史回放是 internal：它失败不许出现在任何源上', () => {
    const view = readStandardWriteFailures(layerOf({
      'macro-calendar-official-replay': { updatedAt: '2026-11-19T12:00:00.000Z', lastFailure: { at: '2026-11-19T12:00:00.000Z', failedRows: 9, firstErrorCode: 'standard-write-failed' } }
    }))
    expect(Object.keys(view.failures)).toEqual([])
    // 回放也确实没有挂到任何源：映射表里没有它。
    expect(STANDARD_WRITER_SOURCES.map(([writerId]) => writerId)).not.toContain('macro-calendar-official-replay')
  })
})
