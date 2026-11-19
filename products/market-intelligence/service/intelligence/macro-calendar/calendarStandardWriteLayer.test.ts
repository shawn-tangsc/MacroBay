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

describe('最近一次当前写失败（freshness 用）', () => {
  it('只认「失败晚于该写入方最后一次成功」的，多写入方时取 at 最新的那个', async () => {
    const { latestCurrentWriteFailure } = await import('./calendarStandardWriteLayer')
    const layer = createCalendarStandardWriteLayer()
    layer.recordAttempt({ writerId: '0xrouter', at: at(1), outcome: { state: 'succeeded' } })
    layer.recordAttempt({ writerId: '0xrouter', at: at(2),
      outcome: { state: 'failed', failedRows: 1, firstErrorCode: 'standard-write-failed' } })
    expect(latestCurrentWriteFailure(layer)).toMatchObject({
      writerId: '0xrouter', at: at(2), code: 'standard-write-failed', lastSuccessAt: at(1)
    })
    // 之后成功一次 → 那次失败不再「当前」，就不再报。
    layer.recordAttempt({ writerId: '0xrouter', at: at(3), outcome: { state: 'succeeded' } })
    expect(latestCurrentWriteFailure(layer)).toBeUndefined()
  })

  it('replay（internal）失败不进 freshness；同样一条换成 0xrouter 才进', async () => {
    const { latestCurrentWriteFailure } = await import('./calendarStandardWriteLayer')
    const layer = createCalendarStandardWriteLayer()
    layer.recordAttempt({ writerId: 'macro-calendar-official-replay', at: at(1),
      outcome: { state: 'failed', failedRows: 3, firstErrorCode: 'standard-write-failed' } })
    // 回放只让历史少一段，不改变当前这期——它的失败不许被读者看见。
    expect(latestCurrentWriteFailure(layer)).toBeUndefined()
    layer.recordAttempt({ writerId: '0xrouter', at: at(2),
      outcome: { state: 'failed', failedRows: 1, firstErrorCode: 'value-shape-rejected' } })
    expect(latestCurrentWriteFailure(layer)).toMatchObject({ writerId: '0xrouter', code: 'value-shape-rejected' })
  })
})

describe('第 3 步：从上一版文件迁移写失败', () => {
  it('搬一次进写入层；重跑 0 变更；不认识的写入方忽略', async () => {
    const { migrateLegacyWriteFailures } = await import('./calendarStandardWriteLayer')
    const layer = createCalendarStandardWriteLayer()
    const legacy = [
      { writerId: 'macro-calendar-bea', at: '2026-11-18T10:00:00.000Z', failedRows: 4,
        firstErrorCode: 'standard-write-failed' as const },
      { writerId: '不认识的写入方', at: '2026-11-18T10:00:00.000Z', failedRows: 1,
        firstErrorCode: 'standard-write-failed' as const }
    ]
    expect(migrateLegacyWriteFailures({ writeLayer: layer, legacy })).toBe(1)
    expect(layer.get('macro-calendar-bea')!.lastFailure).toMatchObject({
      at: '2026-11-18T10:00:00.000Z', failedRows: 4
    })
    // 幂等：重跑不再搬。
    expect(migrateLegacyWriteFailures({ writeLayer: layer, legacy })).toBe(0)
    expect(layer.get('不认识的写入方' as never)).toBeUndefined()
  })
})

describe('第 5 步：启动补种与守卫', () => {
  it('补种只补缺的、不覆盖已有记录；未登记写入方与「有行没记录」分两类报', async () => {
    const { auditStandardWriteRecords, seedStandardWriteRecords } = await import('./calendarStandardWriteLayer')
    const layer = createCalendarStandardWriteLayer()
    // 已有一条真实记录（模拟 bls）：补种不许动它。
    layer.recordAttempt({ writerId: 'macro-calendar-bls', at: '2026-11-18T01:00:00.000Z', outcome: { state: 'succeeded' } })
    const rows = [
      { writerId: 'macro-calendar-bls', rowCount: 31, lastSuccessAt: '2026-11-19T09:00:00.000Z' },
      { writerId: '0xrouter', rowCount: 1332, lastSuccessAt: '2026-11-19T08:00:00.000Z' },
      { writerId: '不在枚举里的写入方', rowCount: 3, lastSuccessAt: '2026-11-19T08:00:00.000Z' }
    ]
    expect(seedStandardWriteRecords({ writeLayer: layer, rows })).toBe(1)
    expect(layer.get('macro-calendar-bls')!.lastSuccessAt).toBe('2026-11-18T01:00:00.000Z')
    expect(layer.get('0xrouter')!.lastSuccessAt).toBe('2026-11-19T08:00:00.000Z')
    expect(auditStandardWriteRecords({ writeLayer: layer, rows })).toEqual({
      unknownWriterIds: ['不在枚举里的写入方'], missingRecords: []
    })
    // 删掉 0xrouter 的记录 → 「行存在必须有记录」红；再补种 → 绿。
    const fresh = createCalendarStandardWriteLayer()
    expect(auditStandardWriteRecords({ writeLayer: fresh, rows }).missingRecords).toEqual(['macro-calendar-bls', '0xrouter'])
    seedStandardWriteRecords({ writeLayer: fresh, rows })
    expect(auditStandardWriteRecords({ writeLayer: fresh, rows }).missingRecords).toEqual([])
  })
})
