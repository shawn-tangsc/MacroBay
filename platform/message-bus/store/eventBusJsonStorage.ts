import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { EventBusArchiveResult, EventBusWriteBlockedReason } from '../contracts/eventBusContracts'
import { createDefaultEventBusStoreState, type EventBusStoreState } from './eventBusStore'
import {
  parseEventBusStoreState,
  serializeEventBusState,
  type EventBusStoreCorruptionProblem,
  type EventBusStoreIntegrity
} from './eventBusStoreFormat'

export type { EventBusArchiveResult, EventBusWriteBlockedReason }

/**
 * 事件总线唯一的落盘点（闸门第二笔）。
 *
 * 读侧把完整性结论带出来（`EventBusStorageReadResult`），写侧**第一件事**看它：`corrupt` /
 * `future-version` 时一个字节都不写。为什么只有这一处：`persist()`、保留期裁剪、将来的导出/修复
 * 都得经过它——每个调用点各判一次，必然漏一个，今天漏掉的正是「启动裁剪」这一路。
 *
 * `platform/message-bus` 里 `writeFile` / `rename` 只允许出现在这个文件里（评审能一眼查的判据）。
 */

/** 读到的完整性结论；只有前三态带状态，后两态是「有内容但读不懂」。 */
export type EventBusStorageReadResult =
  | Readonly<{ integrity: 'empty' | 'ok' | 'unverified-legacy'; state: EventBusStoreState }>
  | Readonly<{ integrity: 'corrupt'; problem: EventBusStoreCorruptionProblem }>
  | Readonly<{ integrity: 'future-version'; formatVersion: number }>

export type EventBusStorage = Readonly<{
  read: () => Promise<EventBusStorageReadResult>
  write: (state: EventBusStoreState) => Promise<void>
  /**
   * **显式**归档一份阻断态的主文件（读者/诊断动作才调用，启动时绝不自动做）：
   * 原文件改名成 `<file>.corrupt-<ISO>`，再写一份 marker 说清「谁、为什么、原路径」。
   * 归档之后主文件不存在 → 下一次读是 `empty`，写重新被允许。
   */
  archiveCorruptStore?: () => Promise<EventBusArchiveResult | undefined>
}>

export const eventBusJsonStoragePolicy = {
  temporaryFileSuffix: '.next',
  writeOrdering: 'requested-order',
  backgroundFailureDiagnostic: 'Event bus background operation failed.',
  archiveMarkerSuffix: '.archive-marker.json'
} as const

/** 写被拒时抛这个：调用方拿到的不是「写成功了」，也不是「文件不存在」。 */
export class EventBusWriteBlockedError extends Error {
  readonly code = 'event-bus-write-blocked'
  readonly reason: EventBusWriteBlockedReason
  readonly integrity: EventBusStoreIntegrity
  readonly filePath: string

  constructor(input: Readonly<{
    reason: EventBusWriteBlockedReason
    integrity: EventBusStoreIntegrity
    filePath: string
  }>) {
    super(`Event bus store write blocked (${input.reason})`)
    this.name = 'EventBusWriteBlockedError'
    this.reason = input.reason
    this.integrity = input.integrity
    this.filePath = input.filePath
  }
}

export function createEventBusJsonStorage(filePath: string): EventBusStorage {
  let writeTail = Promise.resolve()
  let blocked: Readonly<{ reason: EventBusWriteBlockedReason; integrity: EventBusStoreIntegrity }> | undefined

  function blockedError(): EventBusWriteBlockedError {
    return new EventBusWriteBlockedError({
      reason: blocked!.reason,
      integrity: blocked!.integrity,
      filePath
    })
  }

  return {
    async read() {
      let raw: string | undefined
      try {
        raw = await readFile(filePath, 'utf8')
      } catch (error) {
        if (!isMissingFileError(error)) throw error
        // 主文件不存在 = `empty`（首次安装）。`.next` 残留**不改名、不覆盖**：留在原处等下一次正常写。
        raw = undefined
      }

      const parsed = parseEventBusStoreState(raw)
      if (parsed.integrity === 'corrupt') {
        blocked = { reason: parsed.problem === 'checksum-mismatch' ? 'checksum-mismatch' : 'corrupt', integrity: 'corrupt' }
        return parsed
      }
      if (parsed.integrity === 'future-version') {
        blocked = { reason: 'future-version', integrity: 'future-version' }
        return parsed
      }
      blocked = undefined
      return parsed.integrity === 'empty'
        ? { integrity: 'empty', state: createDefaultEventBusStoreState() }
        : parsed
    },

    async write(state) {
      // 第一件事：完整性结论。坏文件/未来版本 → 抛，一个字节都不写。
      if (blocked) throw blockedError()
      // 写前自检：序列化失败（循环引用等）也要拒绝，不许「写一个空文件」顶上。
      const content = `${serializeEventBusState(state)}\n`
      const requestedWrite = writeTail.then(async () => {
        await mkdir(dirname(filePath), { recursive: true })
        const temporaryPath = `${filePath}${eventBusJsonStoragePolicy.temporaryFileSuffix}`
        await writeFile(temporaryPath, content, 'utf8')
        await rename(temporaryPath, filePath)
      })
      writeTail = requestedWrite.catch(() => undefined)
      await requestedWrite
    },

    async archiveCorruptStore() {
      if (!blocked) return undefined
      const { reason, integrity } = blocked
      const stamp = new Date().toISOString().replaceAll(':', '-')
      const archivedPath = `${filePath}.corrupt-${stamp}`
      await rename(filePath, archivedPath)
      const markerPath = `${filePath}${eventBusJsonStoragePolicy.archiveMarkerSuffix}`
      await writeFile(markerPath, `${JSON.stringify({ archivedAt: new Date().toISOString(), reason, integrity, filePath })}\n`, 'utf8')
      // 归档之后主文件不存在：下一次读是 `empty`，写重新被允许。
      blocked = undefined
      return { archivedPath, markerPath, reason }
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
