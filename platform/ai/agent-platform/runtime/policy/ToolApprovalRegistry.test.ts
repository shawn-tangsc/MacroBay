import { describe, expect, it } from 'vitest'

import { ToolApprovalRegistry } from './ToolApprovalRegistry'

describe('tool approval registry', () => {
  it('creates a pending approval request and resolves it when approved', async () => {
    const registry = new ToolApprovalRegistry()

    const pending = registry.createPending({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Bash'
    })

    registry.resolve(pending.approvalId, {
      behavior: 'allow',
      updatedInput: { command: 'mkdir logs' }
    })

    await expect(pending.result).resolves.toEqual({
      behavior: 'allow',
      updatedInput: { command: 'mkdir logs' }
    })
    expect(registry.get(pending.approvalId)).toBeNull()
  })

  it('denies every pending approval for a session when the session is aborted', async () => {
    const registry = new ToolApprovalRegistry()

    const first = registry.createPending({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Bash'
    })
    const second = registry.createPending({
      sessionId: 'session-1',
      toolCallId: 'tool-call-2',
      toolName: 'Write'
    })

    registry.denySession('session-1', 'Session stopped')

    await expect(first.result).resolves.toEqual({ behavior: 'deny', message: 'Session stopped' })
    await expect(second.result).resolves.toEqual({ behavior: 'deny', message: 'Session stopped' })
    expect(registry.listPending()).toEqual([])
  })

  it('clears all pending approvals when the runtime is torn down', async () => {
    const registry = new ToolApprovalRegistry()

    const first = registry.createPending({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Bash'
    })
    const second = registry.createPending({
      sessionId: 'session-2',
      toolCallId: 'tool-call-2',
      toolName: 'Write'
    })

    registry.clearAll('Runtime disposed')

    await expect(first.result).resolves.toEqual({ behavior: 'deny', message: 'Runtime disposed' })
    await expect(second.result).resolves.toEqual({ behavior: 'deny', message: 'Runtime disposed' })
  })

  it('throws on duplicate resolution or missing ids', () => {
    const registry = new ToolApprovalRegistry()
    const pending = registry.createPending({
      sessionId: 'session-1',
      toolCallId: 'tool-call-1',
      toolName: 'Bash'
    })

    registry.resolve(pending.approvalId, { behavior: 'deny', message: 'Nope' })

    expect(() => registry.resolve(pending.approvalId, { behavior: 'deny', message: 'Again' })).toThrow(
      `Tool approval "${pending.approvalId}" was not found.`
    )
    expect(() => registry.resolve('missing', { behavior: 'deny', message: 'Missing' })).toThrow(
      'Tool approval "missing" was not found.'
    )
  })
})
