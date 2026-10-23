export type RuntimeStateOwner = 'platform' | 'product'

export type RuntimeStateStatus = 'idle' | 'running' | 'degraded' | 'failed'

export type RuntimeStateRecord = {
  owner: RuntimeStateOwner
  productId?: string
  resourceId: string
  status: RuntimeStateStatus
  checkpoint?: unknown
  cursorPreview?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  consecutiveFailures: number
  updatedAt: string
}

export type RuntimeStateUpsertInput = {
  owner: RuntimeStateOwner
  productId?: string
  resourceId: string
  status?: RuntimeStateStatus
  checkpoint?: unknown
  cursorPreview?: string
  lastSuccessAt?: string
  lastFailureAt?: string
}

export type RuntimeStateStore = {
  upsert: (input: RuntimeStateUpsertInput) => RuntimeStateRecord
  get: (owner: RuntimeStateOwner, productId: string | undefined, resourceId: string) => RuntimeStateRecord | undefined
  recordSuccess: (
    owner: RuntimeStateOwner,
    productId: string | undefined,
    resourceId: string,
    checkpoint?: unknown,
    cursorPreview?: string
  ) => RuntimeStateRecord
  recordFailure: (
    owner: RuntimeStateOwner,
    productId: string | undefined,
    resourceId: string,
    cursorPreview?: string
  ) => RuntimeStateRecord
  list: () => RuntimeStateRecord[]
}

export const REDACTED_CURSOR_PREVIEW = '[REDACTED]'

export function redactCursorPreview(value: string | undefined, redactPatterns: RegExp[] = []): string | undefined {
  if (!value) return value
  let preview = value
  for (const pattern of redactPatterns) {
    preview = preview.replace(pattern, REDACTED_CURSOR_PREVIEW)
  }
  if (/api[_-]?key|authorization|secret|token/i.test(preview)) {
    return REDACTED_CURSOR_PREVIEW
  }
  return preview
}
