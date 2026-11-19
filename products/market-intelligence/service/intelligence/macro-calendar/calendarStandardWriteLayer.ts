import { readJsonFileRecoveringSync, writeJsonFileAtomicallySync } from '@platform/storage/jsonFileStorage'

import type { MacroCalendarProviderId, MacroCalendarWriteFailureCode } from './macroCalendarContracts'
import { compareIsoTime } from '../public-query/asOfVisibility'

/**
 * **标准表写入层**（用户 2026-11-19，架构师裁决「写入结果独立成一层」）。
 *
 * 为什么独立：健康记录回答「采集怎么样」，这一层回答「写库落没落地」。两件事正交——
 * 今天唯一能显示写失败的 fed/bea 恰好采集也 failed，而采集正常的 `0xrouter` 反倒没有记录；
 * 任何「按 status 推断写入健康」的读法都会得出与事实相反的结论。
 *
 * 三条硬规矩：
 * - **成功也建记录**：写入成功本身就是「这个写入方存在」的证据，且保证「将来失败时有地方落」。
 *   今天 3222/3321 行写失败只打日志，根因就是「只在失败时找记录，从来没人建」；
 * - **永不返回「没有记录所以不写」**：没有既有记录时也能落（与健康层不同）；
 * - **只有一处判断「当前是否写失败」**：`lastFailure.at` 晚于 `lastSuccessAt` 才算当前失败；
 *   简报线与配置线都调 `isCurrentWriteFailure`，**不许自己比时间**。
 */

/**
 * 写入方（谁往标准表写）。**narwhal 不在 `MacroCalendarProviderId` 里**——它的采集状态在
 * feeds/jobs，塞进采集健康那套联合就是把两个概念并回一个。`official-replay` 只写历史、没有采集。
 */
export type CalendarStandardWriterId =
  | MacroCalendarProviderId
  | 'narwhal'
  | 'macro-calendar-official-replay'

/**
 * `reader` = 读者会看到「写失败」这件事（源在设置页有名字）；`internal` = 只写历史，不给读者看。
 * **唯独一处定义**：配置线与简报线 import，不许复制一份。
 * 新增写入方不选边 → 编译报错。
 */
export const calendarStandardWriterVisibility: Readonly<Record<CalendarStandardWriterId, 'reader' | 'internal'>>
  = Object.freeze({
    'macro-calendar-fed': 'reader',
    'macro-calendar-bls': 'reader',
    'macro-calendar-bea': 'reader',
    '0xrouter': 'reader',
    narwhal: 'reader',
    'macro-calendar-official-replay': 'internal'
  })

export type StandardWriteRecord = Readonly<{
  /** 最近一次**写入尝试**（成功或失败）的时刻，UTC ISO。 */
  updatedAt: string
  /** 最近一次**写完落地**的时刻；从没成功过就没有这个键（不编）。 */
  lastSuccessAt?: string
  /** 最近一次写入失败；连续同码失败合并成一条（`streakBatches`）。 */
  lastFailure?: Readonly<{
    at: string
    failedRows: number
    firstErrorCode: MacroCalendarWriteFailureCode
    streakBatches?: number
  }>
}>

/**
 * **「当前是否处于写失败」的唯一判断**（用户 2026-11-19）。
 *
 * 判据：`at` 晚于 `lastSuccessAt` 才算当前失败；`lastSuccessAt` 缺席按**当前失败**算
 * （从没成功过，这次失败就是当前的——方向只能是显示，不是藏）。
 *
 * **把它改成永远返回 false，配置线与简报线的用例必须同时红**——这就是它存在的判据。
 */
export function isCurrentWriteFailure(input: Readonly<{ at: string; lastSuccessAt?: string }>): boolean {
  if (input.lastSuccessAt === undefined || input.lastSuccessAt === '') return true
  /**
   * **不许拿字符串直接比**（用户 2026-11-19 实测反例）：`'…T08:00:00Z' > '…T08:00:00.000Z'`
   * 为 true（`'Z'`=90 > `'.'`=46，逐字符比），同一时刻会被判成「失败更晚」，已恢复的源永远说
   * 「采到了没写进去」。各写入方时刻格式不统一（有的带毫秒），这不是理论问题。
   * 用仓库既有的 `compareIsoTime`（16 处在用）。
   */
  return compareIsoTime(input.at, input.lastSuccessAt) > 0
}

/** 档案：写入方 → 最近一次写入结果（不含历史，历史是 #33 审计表的事）。 */
export type CalendarStandardWriteSnapshot = {
  byWriterId: Partial<Record<CalendarStandardWriterId, StandardWriteRecord>>
}

export type CalendarStandardWriteStorage = {
  read: () => CalendarStandardWriteSnapshot
  write: (snapshot: CalendarStandardWriteSnapshot) => void
}

export type CalendarStandardWriteLayer = {
  /** 读一个写入方的最近写入结果；**没有记录 = 这个写入方还没写过**（不是「读不到」）。 */
  get: (writerId: CalendarStandardWriterId) => StandardWriteRecord | undefined
  /** 全部记录（设置页/盘点用）。 */
  all: () => Partial<Record<CalendarStandardWriterId, StandardWriteRecord>>
  /** 记一次写入尝试：成功更新 `lastSuccessAt`；失败更新 `lastFailure`（同码连续失败合并 + 次数）。 */
  recordAttempt: (input: Readonly<{
    writerId: CalendarStandardWriterId
    at: string
    outcome: Readonly<{ state: 'succeeded' }> | Readonly<{
      state: 'failed'; failedRows: number; firstErrorCode: MacroCalendarWriteFailureCode }>
  }>) => void
}

/**
 * **最近的、当前仍生效的写失败**（用户 2026-11-19）：给 freshness / 设置页用。
 * 只认「失败晚于该写入方最后一次成功」的（`isCurrentWriteFailure`）；没有就返回 undefined。
 * 多个写入方同时失败时取 `at` 最新的那个——读者一次只需要看到一句真话。
 */
export function latestCurrentWriteFailure(layer: Pick<CalendarStandardWriteLayer, 'all'>): Readonly<{
  writerId: CalendarStandardWriterId
  at: string
  code: MacroCalendarWriteFailureCode
  lastSuccessAt?: string
}> | undefined {
  const candidates = Object.entries(layer.all())
    .flatMap(([writerId, record]) => record?.lastFailure === undefined ? []
      : [{ writerId: writerId as CalendarStandardWriterId, record, failure: record.lastFailure }])
    .filter((entry) => isCurrentWriteFailure({ at: entry.failure.at, lastSuccessAt: entry.record.lastSuccessAt }))
    .sort((left, right) => compareIsoTime(right.failure.at, left.failure.at))
  const top = candidates[0]
  if (top === undefined) return undefined
  return { writerId: top.writerId, at: top.failure.at, code: top.failure.firstErrorCode,
    ...(top.record.lastSuccessAt === undefined ? {} : { lastSuccessAt: top.record.lastSuccessAt }) }
}

export function createCalendarStandardWriteLayer(
  storage: CalendarStandardWriteStorage = createInMemoryCalendarStandardWriteStorage()
): CalendarStandardWriteLayer {
  const byWriterId = new Map<CalendarStandardWriterId, StandardWriteRecord>(
    Object.entries(storage.read().byWriterId) as Array<[CalendarStandardWriterId, StandardWriteRecord]>)

  const persist = (): void => { storage.write({ byWriterId: Object.fromEntries(byWriterId) }) }

  return {
    get(writerId) { return byWriterId.get(writerId) },
    all() { return Object.fromEntries(byWriterId) },
    recordAttempt(input) {
      const previous = byWriterId.get(input.writerId)
      if (input.outcome.state === 'succeeded') {
        byWriterId.set(input.writerId, { updatedAt: input.at, lastSuccessAt: input.at,
          ...(previous?.lastFailure === undefined ? {} : { lastFailure: previous.lastFailure }) })
        persist()
        return
      }
      const failure = input.outcome
      // 同码连续失败合并成一条：`at` 保持这一串的第一次，`streakBatches` 累加。
      const merged = previous?.lastFailure !== undefined
        && previous.lastFailure.firstErrorCode === failure.firstErrorCode
        ? { at: previous.lastFailure.at, failedRows: failure.failedRows,
            firstErrorCode: failure.firstErrorCode,
            streakBatches: (previous.lastFailure.streakBatches ?? 1) + 1 }
        : { at: input.at, failedRows: failure.failedRows, firstErrorCode: failure.firstErrorCode }
      byWriterId.set(input.writerId, { updatedAt: input.at, ...(previous?.lastSuccessAt === undefined ? {}
        : { lastSuccessAt: previous.lastSuccessAt }), lastFailure: merged })
      persist()
    }
  }
}

export function createJsonFileCalendarStandardWriteStorage(filePath: string): CalendarStandardWriteStorage {
  return {
    read() {
      const raw = readJsonFileRecoveringSync(filePath) as Partial<CalendarStandardWriteSnapshot> | undefined
      return { byWriterId: (raw?.byWriterId ?? {}) as Partial<Record<CalendarStandardWriterId, StandardWriteRecord>> }
    },
    write(snapshot) { writeJsonFileAtomicallySync(filePath, snapshot) }
  }
}

function createInMemoryCalendarStandardWriteStorage(): CalendarStandardWriteStorage {
  let snapshot: CalendarStandardWriteSnapshot = { byWriterId: {} }
  return { read: () => snapshot, write: (next) => { snapshot = next } }
}