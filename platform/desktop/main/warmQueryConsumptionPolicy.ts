/**
 * WarmQuery consumption fence (WQ-2).
 *
 * One `@anthropic-ai/claude-agent-sdk` `WarmQuery` handle can be handed to
 * `WarmQuery.query()` exactly once. This policy is the single place that decides
 * whether a handle may be consumed: every claim is synchronous and happens before
 * the SDK call is created, and every reused object identity fails closed.
 *
 * Design: warm-query runtime consumption fence.
 *
 * Diagnostics only ever carry opaque platform ids, enum values and an
 * adapter-assigned handle sequence. Prompts, credentials, SDK session/resume
 * tokens, file paths and raw stacks never enter this module, so they cannot
 * reach an audit sink or an error message.
 */

export type WarmQueryConsumptionOrigin = 'prewarm' | 'execute-cache-hit' | 'execute-startup'

export type WarmQueryModuleSource = 'claude-agent-sdk' | 'claude-code-fallback'

export type WarmQueryCloseReason =
  | 'consumed'
  | 'replaced'
  | 'idle'
  | 'aborted'
  | 'startup-duplicate'

export type WarmQueryConsumptionAuditEvent =
  | 'handle-created'
  | 'claim-granted'
  | 'claim-rejected'
  | 'handle-closed'

export interface WarmQueryConsumptionAuditEntry {
  event: WarmQueryConsumptionAuditEvent
  moduleSource: WarmQueryModuleSource
  handleSequence: number
  origin: WarmQueryConsumptionOrigin
  platformSessionId: string
  /** Opaque platform run id; omitted when the caller has no run (for example prewarm). */
  runId?: string
  claimCount: number
  closeReason?: WarmQueryCloseReason
}

export type WarmQueryConsumptionSink = (entry: WarmQueryConsumptionAuditEntry) => void

export type WarmQueryConsumptionErrorCode =
  | 'warm-query-identity-already-consumed'
  | 'warm-query-identity-reused-on-register'
  | 'warm-query-identity-closed'
  | 'warm-query-identity-unregistered'

export interface WarmQueryConsumptionHandleMeta {
  origin: WarmQueryConsumptionOrigin
  moduleSource: WarmQueryModuleSource
  platformSessionId: string
  runId?: string
}

export interface WarmQueryConsumptionPolicy {
  /** Registers a fresh `startup()` result. Re-registering an identity fails closed. */
  register(handle: object, meta: WarmQueryConsumptionHandleMeta): number
  /** Synchronously claims an identity; throws instead of returning on a fence violation. */
  claim(handle: object, meta: WarmQueryConsumptionHandleMeta): number
  /** Claims first, then creates the SDK query. The claim can never lose to an await. */
  claimThenCreate<T>(handle: object, meta: WarmQueryConsumptionHandleMeta, create: () => T): T
  /** Idempotent. Records the close reason once per identity. */
  close(handle: object, reason: WarmQueryCloseReason): void
  /** Read-only diagnostic used by the adapter to decide whether eviction may close a handle. */
  isUnconsumed(handle: object): boolean
}

interface WarmQueryConsumptionRecord {
  sequence: number
  state: 'new' | 'prewarmed' | 'claimed' | 'closed'
  claimCount: number
  /** Last meta that touched this identity, used for close correlation. */
  meta: WarmQueryConsumptionHandleMeta
}

export class WarmQueryConsumptionError extends Error {
  readonly code: WarmQueryConsumptionErrorCode
  readonly handleSequence: number

  constructor(code: WarmQueryConsumptionErrorCode, handleSequence: number) {
    super(`WarmQuery consumption rejected: ${code} (handle #${handleSequence})`)
    this.name = 'WarmQueryConsumptionError'
    this.code = code
    this.handleSequence = handleSequence
  }
}

const UNREGISTERED_SEQUENCE = 0

export function createWarmQueryConsumptionPolicy(options: {
  auditSink?: WarmQueryConsumptionSink
} = {}): WarmQueryConsumptionPolicy {
  const records = new WeakMap<object, WarmQueryConsumptionRecord>()
  let nextSequence = 1

  function emit(
    event: WarmQueryConsumptionAuditEvent,
    meta: WarmQueryConsumptionHandleMeta,
    handleSequence: number,
    claimCount: number,
    closeReason?: WarmQueryCloseReason
  ): void {
    if (!options.auditSink) return
    const entry: WarmQueryConsumptionAuditEntry = {
      event,
      moduleSource: meta.moduleSource,
      handleSequence,
      origin: meta.origin,
      platformSessionId: meta.platformSessionId,
      ...(meta.runId === undefined ? {} : { runId: meta.runId }),
      claimCount,
      ...(closeReason === undefined ? {} : { closeReason })
    }
    try {
      options.auditSink(entry)
    } catch {
      // Audit must never influence send/prewarm. Diagnostics stay best-effort.
    }
  }

  function claim(handle: object, meta: WarmQueryConsumptionHandleMeta): number {
    const record = records.get(handle)
    if (!record) {
      emit('claim-rejected', meta, UNREGISTERED_SEQUENCE, 0)
      throw new WarmQueryConsumptionError('warm-query-identity-unregistered', UNREGISTERED_SEQUENCE)
    }
    if (record.state === 'claimed') {
      emit('claim-rejected', meta, record.sequence, record.claimCount)
      throw new WarmQueryConsumptionError('warm-query-identity-already-consumed', record.sequence)
    }
    if (record.state === 'closed') {
      emit('claim-rejected', meta, record.sequence, record.claimCount)
      throw new WarmQueryConsumptionError('warm-query-identity-closed', record.sequence)
    }
    record.state = 'claimed'
    record.claimCount += 1
    record.meta = meta
    emit('claim-granted', meta, record.sequence, record.claimCount)
    return record.sequence
  }

  return {
    register(handle, meta) {
      const existing = records.get(handle)
      if (existing) {
        emit('claim-rejected', meta, existing.sequence, existing.claimCount)
        throw new WarmQueryConsumptionError(
          'warm-query-identity-reused-on-register',
          existing.sequence
        )
      }
      const record: WarmQueryConsumptionRecord = {
        sequence: nextSequence,
        state: meta.origin === 'prewarm' ? 'prewarmed' : 'new',
        claimCount: 0,
        meta
      }
      nextSequence += 1
      records.set(handle, record)
      emit('handle-created', meta, record.sequence, 0)
      return record.sequence
    },

    claim,

    claimThenCreate(handle, meta, create) {
      claim(handle, meta)
      return create()
    },

    isUnconsumed(handle) {
      const record = records.get(handle)
      return record !== undefined && (record.state === 'new' || record.state === 'prewarmed')
    },

    close(handle, reason) {
      const record = records.get(handle)
      if (!record || record.state === 'closed') return
      record.state = 'closed'
      emit('handle-closed', record.meta, record.sequence, record.claimCount, reason)
    }
  }
}
