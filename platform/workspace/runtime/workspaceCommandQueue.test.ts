import { describe, expect, it } from 'vitest'

import { WorkspaceCommandQueueError, createWorkspaceCommandQueue } from './workspaceCommandQueue'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('workspace command queue', () => {
  it('serializes commands in submission order', async () => {
    const queue = createWorkspaceCommandQueue()
    const gate = deferred<void>()
    const events: string[] = []
    const first = queue.enqueue(async () => {
      events.push('first:start')
      await gate.promise
      events.push('first:end')
      return 'first'
    })
    const second = queue.enqueue(async () => {
      events.push('second')
      return 'second'
    })

    await Promise.resolve()
    expect(events).toEqual(['first:start'])
    gate.resolve()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(events).toEqual(['first:start', 'first:end', 'second'])
    expect(queue.pending()).toBe(0)
  })

  it('continues after one command rejects', async () => {
    const queue = createWorkspaceCommandQueue()
    await expect(queue.enqueue(async () => { throw new Error('expected failure') })).rejects.toThrow('expected failure')
    await expect(queue.enqueue(async () => 'next command')).resolves.toBe('next command')
  })

  it('rejects new commands at the named queue budget without dropping the running command', async () => {
    const queue = createWorkspaceCommandQueue({ maxPendingCommands: 1 })
    const gate = deferred<void>()
    const running = queue.enqueue(async () => {
      await gate.promise
      return 'completed'
    })

    await expect(queue.enqueue(async () => 'overflow')).rejects.toEqual(new WorkspaceCommandQueueError('limit-reached'))
    expect(queue.pending()).toBe(1)
    gate.resolve()
    await expect(running).resolves.toBe('completed')
  })
})
