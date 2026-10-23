import { WorkspaceCommandQueuePolicy } from '../policies'

export class WorkspaceCommandQueueError extends Error {
  constructor(readonly code: 'limit-reached') {
    super(code)
    this.name = 'WorkspaceCommandQueueError'
  }
}

export function createWorkspaceCommandQueue(options: { maxPendingCommands?: number } = {}) {
  const maxPendingCommands = options.maxPendingCommands ?? WorkspaceCommandQueuePolicy.maxPendingCommands
  let pendingCount = 0
  let tail = Promise.resolve()

  return Object.freeze({
    enqueue<T>(command: () => Promise<T> | T): Promise<T> {
      if (!Number.isSafeInteger(maxPendingCommands) || maxPendingCommands < 1 || pendingCount >= maxPendingCommands) {
        return Promise.reject(new WorkspaceCommandQueueError('limit-reached'))
      }
      pendingCount += 1
      const run = tail.then(command)
      tail = run.then(() => undefined, () => undefined)
      return run.finally(() => { pendingCount -= 1 })
    },
    pending(): number { return pendingCount }
  })
}
