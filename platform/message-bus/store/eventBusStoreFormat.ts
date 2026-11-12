import { createHash } from 'node:crypto'

import type { EventBusStoreState } from './eventBusStore'

/**
 * 事件总线持久文件的**格式层**（闸门第一笔：纯函数，没有接线）。
 *
 * 今天的事实是：文件没有版本、没有校验，`JSON.parse` 一失败就被当成「从来没有过数据」，
 * 陌生形状被归一成三个空数组。这条路径最贵的一步不是读坏，而是**读完写回**——坏文件被当空
 * 之后，启动裁剪或下一次发布就把空状态覆盖回磁盘，数据真的没了。
 *
 * 所以这里先把「读到的是什么」说死，共四态（`empty` 另算，它只表示主文件不存在）：
 *
 * | integrity | 含义 | 能不能写 |
 * |---|---|---|
 * | `ok` | v1，校验和通过 | 能 |
 * | `unverified-legacy` | v0（闸门之前的旧文件），读得懂、没有校验和 | 能（写一次即升级为 v1） |
 * | `corrupt` | 有内容但读不懂（非法 JSON / 截断 / 形状不对 / 校验和不符） | 不能，原文件原地留着 |
 * | `future-version` | 更新的版本写的（`formatVersion > 1`） | 不能，不猜 |
 *
 * **`corrupt` 与 `empty` 永不混用**（基础规范第 2 条在本模块的落点）。
 */

export const eventBusStoreFormatPolicy = Object.freeze({
  /** 本版本写出的格式版本。 */
  currentFormatVersion: 1,
  /** 旧文件（没有 `formatVersion` 这一格）按 0 读。 */
  legacyFormatVersion: 0,
  /** 读侧接受的最低版本；低于它的文件不是「旧」，是不认识的形状。 */
  minimumSupportedFormatVersion: 0
})

export type EventBusStoreIntegrity = 'empty' | 'ok' | 'unverified-legacy' | 'corrupt' | 'future-version'

/** `corrupt` 的细分原因：写侧拒绝时也要带上它，别只说一句「坏了」。 */
export type EventBusStoreCorruptionProblem = 'invalid-json' | 'shape' | 'checksum-mismatch'

export type EventBusStoreParseResult =
  | Readonly<{ integrity: 'empty' }>
  | Readonly<{ integrity: 'ok' | 'unverified-legacy'; state: EventBusStoreState }>
  | Readonly<{ integrity: 'corrupt'; problem: EventBusStoreCorruptionProblem }>
  | Readonly<{ integrity: 'future-version'; formatVersion: number }>

/**
 * 规范化 JSON：对象键递归排序、数组保序、无空格。
 *
 * 校验和与落盘字节都从这一个函数出，所以「同一份状态重复写逐字节一致」是结构保证，不是运气：
 * 换了序列化实现（或顺手 prettier 一下）就两样东西一起变。
 */
export function canonicalEventBusJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)])
  )
}

/** 校验和只覆盖 payload（三个数组），不含版本号本身：版本是信封，不是内容。 */
export function eventBusStateChecksum(state: EventBusStoreState): string {
  return createHash('sha256').update(canonicalEventBusJson(payloadOf(state))).digest('hex')
}

function payloadOf(state: EventBusStoreState): Readonly<{
  events: readonly unknown[]
  deliveries: readonly unknown[]
  checkpoints: readonly unknown[]
}> {
  return {
    events: state.events ?? [],
    deliveries: state.deliveries ?? [],
    checkpoints: state.checkpoints ?? []
  }
}

/**
 * 写出一份 v1 文件的内容。
 *
 * 自检：`JSON.stringify` 失败（循环引用、BigInt 之类）会**抛**——调用方据此拒绝写，
 * 不许把「序列化不了」当成「写一个空文件」。
 */
export function serializeEventBusState(state: EventBusStoreState): string {
  const payload = payloadOf(state)
  return canonicalEventBusJson({
    formatVersion: eventBusStoreFormatPolicy.currentFormatVersion,
    checksum: createHash('sha256').update(canonicalEventBusJson(payload)).digest('hex'),
    ...payload
  })
}

/**
 * 读一份文件的内容。
 *
 * `raw === undefined` 表示**主文件不存在**（`empty`）。`.next` 残留的判定与「不自动改名」在
 * 存储适配器那一层（第二笔），这里只回答「给的这串字节是什么」。
 */
export function parseEventBusStoreState(raw: string | undefined): EventBusStoreParseResult {
  if (raw === undefined) return Object.freeze({ integrity: 'empty' as const })

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 截断、半写入、非法 JSON：都是「有内容但读不懂」，不是「没有数据」。
    return corrupt('invalid-json')
  }
  if (!isPlainRecord(parsed)) return corrupt('shape')

  const declaredVersion = parsed.formatVersion
  let formatVersion: number = eventBusStoreFormatPolicy.legacyFormatVersion
  if (declaredVersion !== undefined) {
    if (typeof declaredVersion !== 'number' || !Number.isInteger(declaredVersion)) return corrupt('shape')
    if (declaredVersion < eventBusStoreFormatPolicy.minimumSupportedFormatVersion) return corrupt('shape')
    formatVersion = declaredVersion
  }
  if (formatVersion > eventBusStoreFormatPolicy.currentFormatVersion) {
    // 更新的版本写的：不猜、不降级、不归一成空。
    return Object.freeze({ integrity: 'future-version' as const, formatVersion })
  }

  const events = parsed.events
  const deliveries = parsed.deliveries
  const checkpoints = parsed.checkpoints
  if (!isRecordArray(events) || !isRecordArray(deliveries) || !isRecordArray(checkpoints)) return corrupt('shape')

  const state = {
    events: events as EventBusStoreState['events'],
    deliveries: deliveries as EventBusStoreState['deliveries'],
    checkpoints: checkpoints as EventBusStoreState['checkpoints']
  }

  if (formatVersion === eventBusStoreFormatPolicy.currentFormatVersion) {
    const declaredChecksum = parsed.checksum
    if (typeof declaredChecksum !== 'string') return corrupt('checksum-mismatch')
    if (declaredChecksum !== eventBusStateChecksum(state)) return corrupt('checksum-mismatch')
    return Object.freeze({ integrity: 'ok' as const, state })
  }

  // v0：闸门之前写出的合法旧数据。没有校验和不是损坏。
  return Object.freeze({ integrity: 'unverified-legacy' as const, state })
}

function corrupt(problem: EventBusStoreCorruptionProblem): EventBusStoreParseResult {
  return Object.freeze({ integrity: 'corrupt' as const, problem })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRecordArray(value: unknown): value is readonly Record<string, unknown>[] {
  return Array.isArray(value) && value.every((entry) => isPlainRecord(entry))
}
