import {
  calendarStandardWriterVisibility,
  isCurrentWriteFailure,
  type CalendarStandardWriteLayer,
  type CalendarStandardWriterId
} from '../macro-calendar/calendarStandardWriteLayer'
import type { MarketCalendarWriteFailureView } from '../../../contracts/macro/marketCalendarQueryContracts'

/**
 * 「谁写标准表」→「它写哪些源」的映射（用户 2026-11-19 定：这是**表里的数据**，不在代码里散 if）。
 *
 * 三条 0xRouter feed 映到**一个**写入方，键就是健康记录里的裸名 `'0xrouter'`
 * （`'macro-calendar-0xrouter'` 这个字符串在代码里不存在）。narwhal 同理。
 *
 * **历史回放不在这张表里**：它只写历史行，不改变读者当前看到的那一期，所以它没有「源」可挂；
 * 它的 `internal` 可见性由 `calendarStandardWriterVisibility` 一处定义，这里不重复判。
 */
export const STANDARD_WRITER_SOURCES: ReadonlyArray<readonly [CalendarStandardWriterId, readonly string[]]> = Object.freeze([
  ['0xrouter', Object.freeze([
    'macro-calendar-0xrouter-economic-data',
    'macro-calendar-0xrouter-financial-events',
    'macro-calendar-0xrouter-central-bank-activities'
  ])],
  ['macro-calendar-fed', Object.freeze(['macro-calendar-fed'])],
  ['macro-calendar-bls', Object.freeze(['macro-calendar-bls'])],
  ['macro-calendar-bea', Object.freeze(['macro-calendar-bea'])],
  ['narwhal', Object.freeze([
    'macro-calendar-narwhal-economic-data',
    'macro-calendar-narwhal-financial-events',
    'macro-calendar-narwhal-central-bank-activities'
  ])]
] as const)

/**
 * 一个源在「写库这一列」上的四态（用户 2026-11-19 定，与 `healthState` **并列、永不合并**）：
 *
 * - `unreadable`：读写入层本身失败 → 走既有错误态 + 重试；
 * - `never-written`：该写入方**还没有任何写入记录**（回填/首次写之前）→ 走既有空态，
 *   **不是「确实没失败」**，也不是「读不到」；
 * - `no-failure`：有记录、没有**当前**失败 → 界面**什么都不说**（这一列只有「失败」与「没失败」，
 *   没有「健康」这个评价；健康只由 `healthState` 说）；
 * - `failed`：有当前失败且该写入方是 `reader` 类 → 那两句之一。
 *
 * `internal` 类（历史回放）永远不落 `failed`：读的是同一张可见性表，不另判一次。
 */
export type SourceWriteFailureState =
  | Readonly<{ kind: 'unreadable' }>
  | Readonly<{ kind: 'never-written' }>
  | Readonly<{ kind: 'no-failure' }>
  | Readonly<{ kind: 'failed'; failure: MarketCalendarWriteFailureView }>

export type SourceWriteFailureView = Readonly<{
  /** 有当前失败时才有值（`kind === 'failed'`）。 */
  failures: Readonly<Record<string, MarketCalendarWriteFailureView>>
  /** 空态（还没写过）：源 id 集合。 */
  neverWritten: Readonly<Record<string, true>>
  /** 读失败：源 id 集合。 */
  unreadable: Readonly<Record<string, true>>
}>

/** 供设置页/用例读的单源结论；`no-failure` 就是「什么都不说」。 */
export function writeFailureStateOf(view: SourceWriteFailureView, sourceId: string): SourceWriteFailureState {
  const failure = view.failures[sourceId]
  if (failure !== undefined) return { kind: 'failed', failure }
  if (view.unreadable[sourceId] === true) return { kind: 'unreadable' }
  if (view.neverWritten[sourceId] === true) return { kind: 'never-written' }
  return { kind: 'no-failure' }
}

/**
 * 从写入层读出「按源」的四态。装配层只需把 `createCalendarStandardWriteLayer(...)` 交进来。
 *
 * 多个写入方可能写同一个源？现在不会（表里一个源只属一个写入方）；真出现时后写的覆盖先写的，
 * 这一点在表里保持一行一源，避免读者看到两条矛盾的结论。
 */
export function readStandardWriteFailures(layer: Pick<CalendarStandardWriteLayer, 'get'>): SourceWriteFailureView {
  const failures: Record<string, MarketCalendarWriteFailureView> = {}
  const neverWritten: Record<string, true> = {}
  const unreadable: Record<string, true> = {}
  for (const [writerId, sourceIds] of STANDARD_WRITER_SOURCES) {
    let record: ReturnType<CalendarStandardWriteLayer['get']>
    try {
      record = layer.get(writerId)
    } catch {
      // 读不到 ≠ 没失败：整组走错误态，界面给重试。
      for (const sourceId of sourceIds) unreadable[sourceId] = true
      continue
    }
    if (record === undefined) {
      // 这个写入方**还没写过**（不是读不到，也不是没失败）。
      for (const sourceId of sourceIds) neverWritten[sourceId] = true
      continue
    }
    const failure = record.lastFailure
    /* 「是不是当前失败」只调写入层那一个函数，不在这里比时间；可见性也只读那一张表。 */
    if (failure === undefined
      || calendarStandardWriterVisibility[writerId] !== 'reader'
      || !isCurrentWriteFailure({ at: failure.at, lastSuccessAt: record.lastSuccessAt })) continue
    for (const sourceId of sourceIds) {
      failures[sourceId] = { at: failure.at, code: failure.firstErrorCode }
    }
  }
  return {
    failures: Object.freeze(failures),
    neverWritten: Object.freeze(neverWritten),
    unreadable: Object.freeze(unreadable)
  }
}