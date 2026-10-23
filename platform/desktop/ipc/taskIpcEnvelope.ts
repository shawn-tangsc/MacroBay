export const taskIpcErrorCodes = [
  'task-autonomy-required',
  'task-ownership-denied',
  'task-not-found',
  'task-revision-conflict',
  'task-completed',
  'task-schedule-invalid',
  'task-timezone-invalid',
  'task-policy-limit',
  'task-channel-ineligible',
  'task-request-invalid',
  'task-not-runnable',
  'task-result-unavailable',
  'task-delivery-not-retryable',
  'task-internal-error'
] as const

export type TaskIpcErrorCode = (typeof taskIpcErrorCodes)[number]
export type TaskIpcEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: TaskIpcErrorCode } }

export class TaskIpcError extends Error {
  constructor(readonly code: TaskIpcErrorCode) {
    super(code)
    this.name = 'TaskIpcError'
  }
}

export async function serializeTaskIpc<T>(operation: () => Promise<T> | T): Promise<TaskIpcEnvelope<T>> {
  try {
    return { ok: true, data: await operation() }
  } catch (error) {
    return { ok: false, error: { code: normalizeTaskIpcErrorCode(error) } }
  }
}

export function unwrapTaskIpc<T>(value: unknown): T {
  if (!value || typeof value !== 'object') throw new TaskIpcError('task-internal-error')
  const envelope = value as Partial<TaskIpcEnvelope<T>>
  if (envelope.ok === true && 'data' in envelope) return envelope.data as T
  if (envelope.ok === false && envelope.error && typeof envelope.error === 'object') {
    const code = (envelope.error as { code?: unknown }).code
    if (isTaskIpcErrorCode(code)) throw new TaskIpcError(code)
  }
  throw new TaskIpcError('task-internal-error')
}

function normalizeTaskIpcErrorCode(error: unknown): TaskIpcErrorCode {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  return isTaskIpcErrorCode(code) ? code : 'task-internal-error'
}

function isTaskIpcErrorCode(value: unknown): value is TaskIpcErrorCode {
  return typeof value === 'string' && (taskIpcErrorCodes as readonly string[]).includes(value)
}
