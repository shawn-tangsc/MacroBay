import { describe, expect, it } from 'vitest'

import { TaskIpcError, serializeTaskIpc, unwrapTaskIpc } from './taskIpcEnvelope'

describe('task IPC envelope', () => {
  it('preserves allowlisted codes and data', async () => {
    await expect(serializeTaskIpc(async () => ({ id: 'task-1' }))).resolves.toEqual({ ok: true, data: { id: 'task-1' } })
    for (const code of ['task-revision-conflict', 'task-request-invalid', 'task-not-runnable'] as const) {
      await expect(serializeTaskIpc(async () => { throw Object.assign(new Error(code), { code }) })).resolves.toEqual({ ok: false, error: { code } })
    }
  })

  it('normalizes unknown failures and malformed renderer envelopes without leaking details', async () => {
    const secret = 'SQL /private/path api-key=secret stack-trace'
    const result = await serializeTaskIpc(async () => { throw new Error(secret) })
    expect(result).toEqual({ ok: false, error: { code: 'task-internal-error' } })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(() => unwrapTaskIpc({ nope: true })).toThrow(TaskIpcError)
    try { unwrapTaskIpc({ nope: true }) } catch (error) { expect(error).toMatchObject({ code: 'task-internal-error' }) }
  })

})
