import { createHash } from 'node:crypto'

import type { SourceRequestGovernancePolicy } from '../schema/intelligenceSource'

export type SourceRequestGovernanceFailureCode = 'request-rate-limited' | 'source-disabled' | 'request-cancelled' | 'queue-closed'

export class SourceRequestGovernanceError extends Error {
  constructor(readonly code: SourceRequestGovernanceFailureCode) {
    super(code)
  }
}

type QueueIntent = 'automatic' | 'run-now' | 'user'

type QueueRequest<T> = {
  sourceId: string
  policy?: SourceRequestGovernancePolicy
  apiKey?: string
  intent?: QueueIntent
  signal?: AbortSignal
  run: () => Promise<T>
}

type PendingRequest = {
  sourceId: string
  scope: string
  policy: SourceRequestGovernancePolicy
  intent: QueueIntent
  enqueuedAt: number
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  run: () => Promise<unknown>
}

const sourceRequestGovernanceQueuePolicy = Object.freeze({
  automaticIntent: 'automatic' as const,
  runNowIntent: 'run-now' as const,
  userIntent: 'user' as const,
  opaqueScopeDigestAlgorithm: 'sha256'
})

export function createSourceRequestGovernanceQueue(deps: { now: () => number }) {
  const pending: PendingRequest[] = []
  const dispatchedAtByScope = new Map<string, number[]>()
  const disabledSourceIds = new Set<string>()
  let closed = false
  let wakeTimer: ReturnType<typeof setTimeout> | undefined
  let wakeAt: number | undefined

  function complete<T>(request: PendingRequest, run: () => Promise<T>): void {
    void run().then(request.resolve, request.reject)
  }

  function discard(request: PendingRequest, code: SourceRequestGovernanceFailureCode): void {
    request.reject(new SourceRequestGovernanceError(code))
  }

  function isBlockedByDisabledSource(request: PendingRequest): boolean {
    return disabledSourceIds.has(request.sourceId) && request.intent !== sourceRequestGovernanceQueuePolicy.userIntent
  }

  function scheduleWake(delayMs: number): void {
    if (delayMs <= 0) return
    const target = deps.now() + delayMs
    if (wakeTimer && wakeAt !== undefined && wakeAt <= target) return
    if (wakeTimer) clearTimeout(wakeTimer)
    wakeAt = target
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined
      wakeAt = undefined
      pump()
    }, delayMs)
    wakeTimer.unref?.()
  }

  function expireAndDispatch(): void {
    const now = deps.now()
    for (let index = 0; index < pending.length;) {
      const request = pending[index]
      if (closed) {
        pending.splice(index, 1)
        discard(request, 'queue-closed')
        continue
      }
      if (isBlockedByDisabledSource(request)) {
        pending.splice(index, 1)
        discard(request, 'source-disabled')
        continue
      }
      const dispatches = (dispatchedAtByScope.get(request.scope) ?? []).filter((at) => now - at < request.policy.rollingWindow.windowMs)
      dispatchedAtByScope.set(request.scope, dispatches)
      if (dispatches.length >= request.policy.rollingWindow.maxRequests) {
        const waitRemaining = request.policy.queue.maxWaitMs - (now - request.enqueuedAt)
        if (waitRemaining <= 0) {
          pending.splice(index, 1)
          discard(request, 'request-rate-limited')
          continue
        }
        scheduleWake(waitRemaining)
        scheduleWake(request.policy.rollingWindow.windowMs - (now - dispatches[0]))
        index += 1
        continue
      }
      pending.splice(index, 1)
      dispatches.push(now)
      dispatchedAtByScope.set(request.scope, dispatches)
      complete(request, request.run)
    }
  }

  function scopeFor(request: QueueRequest<unknown>): string {
    if (!request.policy) return ''
    const scopeValue = request.policy.quotaScope === 'api-key' ? request.apiKey : request.sourceId
    if (!scopeValue) throw new SourceRequestGovernanceError('request-rate-limited')
    return createHash(sourceRequestGovernanceQueuePolicy.opaqueScopeDigestAlgorithm)
      .update(`${request.policy.providerId}:${scopeValue}`)
      .digest('hex')
  }

  function pump(): void {
    if (wakeTimer) {
      clearTimeout(wakeTimer)
      wakeTimer = undefined
      wakeAt = undefined
    }
    expireAndDispatch()
  }

  return Object.freeze({
    enqueue<T>(request: QueueRequest<T>): Promise<T> {
      if (!request.policy) return request.run()
      const policy = request.policy
      if (closed) return Promise.reject(new SourceRequestGovernanceError('queue-closed'))
      const intent = request.intent ?? sourceRequestGovernanceQueuePolicy.automaticIntent
      if (disabledSourceIds.has(request.sourceId) && intent !== sourceRequestGovernanceQueuePolicy.userIntent) {
        return Promise.reject(new SourceRequestGovernanceError('source-disabled'))
      }
      const scope = scopeFor(request)
      const existing = pending.filter((item) => item.scope === scope).length
      if (existing >= policy.queue.maxPending) return Promise.reject(new SourceRequestGovernanceError('request-rate-limited'))
      return new Promise<T>((resolve, reject) => {
        if (request.signal?.aborted) {
          reject(new SourceRequestGovernanceError('request-cancelled'))
          return
        }
        const pendingRequest: PendingRequest = {
          sourceId: request.sourceId,
          scope,
          policy,
          intent,
          enqueuedAt: deps.now(),
          resolve: (value) => resolve(value as T),
          reject,
          run: request.run
        }
        request.signal?.addEventListener('abort', () => {
          const index = pending.indexOf(pendingRequest)
          if (index >= 0) {
            pending.splice(index, 1)
            discard(pendingRequest, 'request-cancelled')
          }
        }, { once: true })
        pending.push(pendingRequest)
        pump()
      })
    },
    disableSource(sourceId: string): void {
      disabledSourceIds.add(sourceId)
      pump()
    },
    close(): void {
      closed = true
      pump()
    },
    pendingCount(): number {
      return pending.length
    },
    pump
  })
}
