import { describe, expect, it } from 'vitest'

import {
  calendarStandardWriterVisibility,
  createCalendarStandardWriteLayer,
  isCurrentWriteFailure
} from './calendarStandardWriteLayer'

/**
 * 写入层（用户 2026-11-19）：成功也建记录、「当前是否写失败」只有一处判断。
 * 判据：把 `isCurrentWriteFailure` 改成永远 false，配置线与简报线的用例必须同时红。
 */
const at = (hour: number) => `2026-11-19T0${hour}:00:00.000Z`

describe('写入层', () => {
  it('成功也建记录（没有既有记录也能落，不存在「没记录就不写」那条路）', () => {
    const layer = createCalendarStandardWriteLayer()
    layer.recordAttempt({ writerId: '0xrouter', at: at(1), outcome: { state: 'succeeded' } })
    expect(layer.get('0xrouter')).toEqual({ updatedAt: at(1), lastSuccessAt: at(1) })
  })

  it('失败落 lastFailure；同码连续失败合并成一条并计次数；成功后保留失败记录', () => {
    const layer = createCalendarStandardWriteLayer()
    layer.recordAttempt({ writerId: '0xrouter', at: at(1),
      outcome: { state: 'failed', failedRows: 2, firstErrorCode: 'standard-write-failed' } })
    layer.recordAttempt({ writerId: '0xrouter', at: at(2),
      outcome: { state: 'failed', failedRows: 3, firstErrorCode: 'standard-write-failed' } })
    expect(layer.get('0xrouter')!.lastFailure).toMatchObject({ at: at(1), streakBatches: 2, failedRows: 3 })
    layer.recordAttempt({ writerId: '0xrouter', at: at(3), outcome: { state: 'succeeded' } })
    expect(layer.get('0xrouter')).toMatchObject({ lastSuccessAt: at(3) })
    expect(layer.get('0xrouter')!.lastFailure?.at).toBe(at(1))
  })

  it('当前失败的判断：失败晚于最后一次成功才算；没成功过按当前失败算', () => {
    expect(isCurrentWriteFailure({ at: at(2) })).toBe(true)
    expect(isCurrentWriteFailure({ at: at(2), lastSuccessAt: at(1) })).toBe(true)
    expect(isCurrentWriteFailure({ at: at(1), lastSuccessAt: at(2) })).toBe(false)
    expect(isCurrentWriteFailure({ at: at(2), lastSuccessAt: at(2) })).toBe(false)
    // **同一时刻、不同格式**：`'Z'` 与 `'.'` 逐字符比会判反，这条用例就是防它被改回 `>`。
    expect(isCurrentWriteFailure({
      at: '2026-11-19T08:00:00Z', lastSuccessAt: '2026-11-19T08:00:00.000Z'
    })).toBe(false)
  })

  it('可见性：replay 是 internal，其余写入方是 reader（新增写入方不选边会编译报错）', () => {
    expect(calendarStandardWriterVisibility['macro-calendar-official-replay']).toBe('internal')
    expect(calendarStandardWriterVisibility['0xrouter']).toBe('reader')
    expect(calendarStandardWriterVisibility.narwhal).toBe('reader')
  })
})
