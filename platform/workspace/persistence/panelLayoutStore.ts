import { stat } from 'node:fs/promises'

import { createJsonFileStorage, type JsonFileStorage } from '../../storage/jsonFileStorage'
import {
  WorkspaceLayoutBudgetPolicy,
  WorkspaceRestorePolicy,
  WorkspaceWritePolicy,
  type PanelLayoutRejectionReason
} from './panelLayoutDocument'
import {
  documentByteSizeV2,
  emptyWorkspaceLayoutDocumentV2,
  validateWorkspaceLayoutDocumentV2,
  type WorkspaceLayoutDocumentV2
} from './workspaceLayoutDocument'
import { convertWorkspaceLayoutDocument } from './workspaceLayoutV1Upgrade'

/**
 * Owner: platform/workspace/persistence。权威：技术设计 §7 Storage Plan / §8 WorkspaceWritePolicy+RestorePolicy。
 * 复用 `platform/storage/jsonFileStorage`（`.next → rename` 原子替换，不宣称 fsync）。本模块只负责：
 * 有界读写、单 writer + latest-pending 合并、saved/pending/failed 状态、读取预算与安全降级。
 * 诊断只出计数/字节/耗时/安全枚举，绝不含文档内容、binding、路径或 secret。
 * 「已存在但未验证」的文件（损坏 / 未知版本 / 非法 / 过大 / 读失败 / 超时）绝不被覆写，必须显式 reset()。
 *
 * P2-04（用户批准的**唯一** v1→v2 转换例外）：本 store 的**写路径只有 v2**。
 * 读路径只有两条——v2 直通、已 Accepted 的 v1 一次性升级（`convertWorkspaceLayoutDocument`）；
 * 其余版本一律 `unknown-schema-version` 并保护原文件。读到 v1 时立刻把升级后的 v2 压进待写槽
 * （一次转换写），此后不再有任何旧格式双写。
 */

export type PanelLayoutDiagnostic = { kind: 'load' | 'save'; bytes: number; durationMs: number; outcome: 'loaded' | 'default' | 'saved' | 'failed' | 'skipped' }
export type PanelLayoutLoadReason = 'missing' | 'too-large' | 'corrupt' | 'read-failed' | 'timeout' | PanelLayoutRejectionReason
export type PanelLayoutLoadResult = {
  outcome: 'loaded' | 'default'; document: WorkspaceLayoutDocumentV2; reason?: PanelLayoutLoadReason
  bytes: number; durationMs: number; mayOverwrite: boolean
  /** 本次读取是否触发了一次性 v1→v2 转换（true = 已把 v2 压进待写槽，等待单 writer 落盘）。 */
  convertedFromV1: boolean
}
export type PanelLayoutSaveResult = {
  outcome: 'saved' | 'failed' | 'skipped'; reason?: 'write-failed' | 'invalid-document' | 'document-too-large' | 'reset-required'
  bytes: number; revision: number
}

type TimerPort = { schedule: (delayMs: number, run: () => void) => () => void }
type ReadOutcome = 'timeout' | { kind: 'value'; value: unknown } | { kind: 'error'; error: unknown }

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError
}

export function createPanelLayoutStore(options: {
  filePath: string
  /** 读入的是**未验证**的 JSON：任何形状判断都在 `convertWorkspaceLayoutDocument` 里 fail closed。 */
  storage?: JsonFileStorage<unknown>
  timers?: TimerPort
  now?: () => number
  readBudgetMs?: number
  mergeWindowMs?: number
  onDiagnostics?: (event: PanelLayoutDiagnostic) => void
}) {
  const readBudgetMs = options.readBudgetMs ?? WorkspaceRestorePolicy.readBudgetMs
  const mergeWindowMs = options.mergeWindowMs ?? WorkspaceWritePolicy.boundsMergeMs
  const now = options.now ?? (() => Date.now())
  const timers = options.timers ?? { schedule: (delayMs: number, run: () => void) => { const id = setTimeout(run, delayMs); return () => clearTimeout(id) } }
  const storage = options.storage ?? createJsonFileStorage<unknown>(options.filePath, emptyWorkspaceLayoutDocumentV2())
  const diagnose = (kind: PanelLayoutDiagnostic['kind'], bytes: number, durationMs: number, outcome: PanelLayoutDiagnostic['outcome']): void => {
    options.onDiagnostics?.({ kind, bytes, durationMs, outcome })
  }

  let state: 'saved' | 'pending' | 'failed' = 'saved'
  let pending: { document: WorkspaceLayoutDocumentV2; revision: number } | null = null
  let cancelMerge: (() => void) | null = null
  let inFlight: Promise<PanelLayoutSaveResult> | null = null
  let protectExistingFile = false

  async function fileSize(): Promise<number | null> {
    try {
      return (await stat(options.filePath)).size
    } catch (error) {
      return isMissingFile(error) ? null : -1
    }
  }

  async function readWithinBudget(): Promise<ReadOutcome> {
    let markTimeout: () => void = () => undefined
    const timeout = new Promise<'timeout'>((resolve) => { markTimeout = () => resolve('timeout') })
    let cancel: (() => void) | null = null
    try {
      cancel = timers.schedule(readBudgetMs, () => markTimeout())
    } catch {
      markTimeout() // 端口不可用 ⇒ 与其它注入端口一致：按超时降级，不读入、保护原文件
      return 'timeout'
    }
    const outcome = await Promise.race<ReadOutcome>([
      storage.read().then(
        (value) => ({ kind: 'value' as const, value }),
        (error: unknown) => ({ kind: 'error' as const, error })
      ),
      timeout
    ])
    cancel?.()
    return outcome
  }

  async function performWrite(write: { document: WorkspaceLayoutDocumentV2; revision: number }): Promise<PanelLayoutSaveResult> {
    const started = now()
    const validation = validateWorkspaceLayoutDocumentV2(write.document)
    if (validation.status === 'rejected') {
      const reason = validation.reason === 'document-too-large' ? 'document-too-large' as const : 'invalid-document' as const
      state = 'failed'
      diagnose('save', 0, now() - started, 'failed')
      return { outcome: 'failed', reason, bytes: 0, revision: write.revision }
    }
    const bytes = documentByteSizeV2(validation.document)
    if (protectExistingFile) {
      state = 'failed'
      diagnose('save', bytes, now() - started, 'failed')
      return { outcome: 'failed', reason: 'reset-required', bytes, revision: write.revision }
    }
    if (bytes > WorkspaceLayoutBudgetPolicy.maxDocumentBytes) {
      state = 'failed'
      diagnose('save', bytes, now() - started, 'failed')
      return { outcome: 'failed', reason: 'document-too-large', bytes, revision: write.revision }
    }
    try {
      await storage.write(validation.document)
    } catch {
      state = 'failed'
      diagnose('save', bytes, now() - started, 'failed')
      return { outcome: 'failed', reason: 'write-failed', bytes, revision: write.revision }
    }
    // 成功：只有确实没有更新待写时才报 saved（在飞期间到达的更新必须继续被写，绝不伪报）
    if (pending === write) { pending = null; state = 'saved' } else { state = 'pending' }
    diagnose('save', bytes, now() - started, 'saved')
    return { outcome: 'saved', bytes, revision: write.revision }
  }

  /** 单 writer 串行写完所有待写（latest-pending 只留最新一份）；失败即停止并保留待写供 reset/重试。 */
  async function drain(): Promise<PanelLayoutSaveResult> {
    let last: PanelLayoutSaveResult = { outcome: 'skipped', bytes: 0, revision: 0 }
    while (pending !== null) {
      const write = pending
      cancelMerge?.()
      cancelMerge = null
      last = await performWrite(write)
      if (last.outcome !== 'saved') break
      if (pending === write) break // 防御：成功却未清空待写时立即停止，绝不空转
    }
    return last
  }

  async function flush(): Promise<PanelLayoutSaveResult> {
    // 在飞时必须等它落定后重查 pending，不得静默返回旧 Promise 就结束
    if (inFlight) await inFlight.catch(() => undefined)
    if (pending === null) return { outcome: 'skipped', bytes: 0, revision: 0 }
    inFlight = drain().finally(() => { inFlight = null })
    return inFlight
  }

  /** 唯一写入口：待写槽位（0/1）+ 合并窗口；只接受 v2 文档。 */
  function schedule(document: WorkspaceLayoutDocumentV2, revision = document.layoutRevision): void {
    pending = { document, revision }
    state = 'pending'
    if (cancelMerge !== null) return
    const runMerge = (): void => { cancelMerge = null; void flush().catch(() => undefined) }
    try {
      cancelMerge = timers.schedule(mergeWindowMs, runMerge)
    } catch {
      runMerge() // 端口不可用 ⇒ 立即落盘，绝不把异常抛给调用方
    }
  }

  return Object.freeze({
    /** 启动时异步有界读取；任何失败都只降级为安全默认，绝不抛给主窗。 */
    async load(): Promise<PanelLayoutLoadResult> {
      const started = now()
      let convertedFromV1 = false
      const degrade = (reason: PanelLayoutLoadReason, protect: boolean, bytes: number): PanelLayoutLoadResult => {
        if (protect) protectExistingFile = true
        const durationMs = now() - started
        diagnose('load', bytes, durationMs, 'default')
        return {
          outcome: 'default', document: emptyWorkspaceLayoutDocumentV2(), reason, bytes, durationMs,
          mayOverwrite: !protectExistingFile, convertedFromV1
        }
      }

      const size = await fileSize()
      if (size === null) return degrade('missing', false, 0)
      if (size < 0) return degrade('read-failed', true, 0)
      if (size > WorkspaceLayoutBudgetPolicy.maxDocumentBytes) return degrade('too-large', true, size)

      const read = await readWithinBudget()
      if (read === 'timeout') return degrade('timeout', true, size)
      if (read.kind === 'error') return degrade(isSyntaxError(read.error) ? 'corrupt' : 'read-failed', true, size)

      const conversion = convertWorkspaceLayoutDocument(read.value)
      if (conversion.status === 'rejected') return degrade(conversion.reason, true, size)

      protectExistingFile = false // 文件已通过校验：mayOverwrite 与 canOverwrite 从此恒一致
      if (conversion.source === 'v1-upgrade') {
        // 唯一转换例外：升级后立刻写一次 v2，此后写路径只有 v2（无旧格式双写）
        convertedFromV1 = true
        schedule(conversion.document)
      }
      const durationMs = now() - started
      diagnose('load', size, durationMs, 'loaded')
      return {
        outcome: 'loaded', document: conversion.document, bytes: size, durationMs,
        mayOverwrite: true, convertedFromV1
      }
    },

    schedule,

    flush,

    /** 显式 reset：只有它能解除「不覆写已存在但未验证文件」的保护。 */
    reset(): void {
      protectExistingFile = false
      state = pending === null ? 'saved' : 'pending' // 有待写时不得报 saved
    },

    persistenceState(): 'saved' | 'pending' | 'failed' {
      return state
    },

    /** 待写槽位（0 或 1），用于证明内存/待写状态有界。 */
    pendingWriteCount(): number {
      return pending === null ? 0 : 1
    },

    canOverwrite(): boolean {
      return !protectExistingFile
    }
  })
}
