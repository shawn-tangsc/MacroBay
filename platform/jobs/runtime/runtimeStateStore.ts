import type {
  RuntimeStateRecord,
  RuntimeStateStore,
  RuntimeStateUpsertInput
} from '../contracts/runtimeStateTypes'
import { redactCursorPreview } from '../contracts/runtimeStateTypes'

export function createRuntimeStateStore(options?: {
  cursorRedactPatterns?: RegExp[]
}): RuntimeStateStore {
  const records = new Map<string, RuntimeStateRecord>()
  const cursorRedactPatterns = options?.cursorRedactPatterns ?? []

  return {
    upsert(input) {
      const key = toKey(input.owner, input.productId, input.resourceId)
      const existing = records.get(key)
      const next: RuntimeStateRecord = {
        owner: input.owner,
        productId: input.productId,
        resourceId: input.resourceId,
        status: input.status ?? existing?.status ?? 'idle',
        checkpoint: input.checkpoint ?? existing?.checkpoint,
        cursorPreview:
          input.cursorPreview !== undefined
            ? redactCursorPreview(input.cursorPreview, cursorRedactPatterns)
            : existing?.cursorPreview,
        lastSuccessAt: input.lastSuccessAt ?? existing?.lastSuccessAt,
        lastFailureAt: input.lastFailureAt ?? existing?.lastFailureAt,
        consecutiveFailures: existing?.consecutiveFailures ?? 0,
        updatedAt: nowIso()
      }
      records.set(key, next)
      return next
    },
    get(owner, productId, resourceId) {
      return records.get(toKey(owner, productId, resourceId))
    },
    recordSuccess(owner, productId, resourceId, checkpoint, cursorPreview) {
      const key = toKey(owner, productId, resourceId)
      const existing = records.get(key)
      const next: RuntimeStateRecord = {
        owner,
        productId,
        resourceId,
        status: 'idle',
        checkpoint: checkpoint ?? existing?.checkpoint,
        cursorPreview: redactCursorPreview(cursorPreview ?? existing?.cursorPreview, cursorRedactPatterns),
        lastSuccessAt: nowIso(),
        lastFailureAt: existing?.lastFailureAt,
        consecutiveFailures: 0,
        updatedAt: nowIso()
      }
      records.set(key, next)
      return next
    },
    recordFailure(owner, productId, resourceId, cursorPreview) {
      const key = toKey(owner, productId, resourceId)
      const existing = records.get(key)
      const next: RuntimeStateRecord = {
        owner,
        productId,
        resourceId,
        status: 'failed',
        checkpoint: existing?.checkpoint,
        cursorPreview: redactCursorPreview(cursorPreview ?? existing?.cursorPreview, cursorRedactPatterns),
        lastSuccessAt: existing?.lastSuccessAt,
        lastFailureAt: nowIso(),
        consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
        updatedAt: nowIso()
      }
      records.set(key, next)
      return next
    },
    list() {
      return [...records.values()]
    }
  }
}

function toKey(owner: RuntimeStateUpsertInput['owner'], productId: string | undefined, resourceId: string): string {
  return `${owner}:${productId ?? ''}:${resourceId}`
}

function nowIso(): string {
  return new Date().toISOString()
}
