import { describe, expect, it, vi } from 'vitest'

import { ChannelInboundExecutionCoordinator } from './ChannelInboundExecutionCoordinator'

describe('ChannelInboundExecutionCoordinator', () => {
  const claim = { workItemId: 'work-a', receiptId: 'receipt-a', channelId: 'channel-a', dispatchId: 'dispatch-a', generation: 1, leaseToken: 'lease-a', leaseExpiresAt: '2026-07-19T01:00:00.000Z' }

  it('does not run an Agent without an exact admitted execution owner', async () => {
    const runtime = { sendMessage: vi.fn() }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: { admitDispatch: () => null } as never, delivery: {} as never, cipher: {} as never, runtime: runtime as never
    })
    await expect(coordinator.execute(claim)).resolves.toBe('deferred')
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('marks a recovered started run interrupted instead of calling the Agent twice', async () => {
    const runtime = { sendMessage: vi.fn() }
    const runs = { get: vi.fn(() => ({ status: 'started' as const })), fail: vi.fn() }
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new Uint8Array(), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })),
      finalizeDispatch: vi.fn(() => true),
      renewDispatchLease: vi.fn((value) => value)
    }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never, delivery: {} as never, cipher: {} as never, runtime: runtime as never, runs: runs as never
    })
    await expect(coordinator.execute(claim)).resolves.toBe('failed')
    expect(runtime.sendMessage).not.toHaveBeenCalled()
    expect(runs.fail).toHaveBeenCalledWith('dispatch-a', 'interrupted', expect.any(Date))
  })

  it('redelivers a stored result without rerunning the Agent after completion', async () => {
    const runtime = { sendMessage: vi.fn() }
    const runs = {
      get: vi.fn(() => ({ status: 'completed' as const })),
      getResult: vi.fn(() => ({ textCiphertext: new Uint8Array([1]), textKeyRef: 'ref', textKeyRevision: 1, status: 'pending' as const })),
      markResult: vi.fn()
    }
    const delivery = { deliverStreamFinal: vi.fn(async () => ({ status: 'delivered' })) }
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new Uint8Array(), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })),
      finalizeDispatch: vi.fn(() => true),
      renewDispatchLease: vi.fn((value) => value)
    }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never, delivery: delivery as never,
      cipher: { decrypt: async () => new TextEncoder().encode('stored reply') } as never,
      runtime: runtime as never, runs: runs as never
    })
    await expect(coordinator.execute(claim)).resolves.toBe('completed')
    expect(runtime.sendMessage).not.toHaveBeenCalled()
    expect(delivery.deliverStreamFinal).toHaveBeenCalledWith(expect.objectContaining({ text: 'stored reply' }), ['stored reply'])
    expect(runs.markResult).toHaveBeenCalledWith('dispatch-a', 'delivered', expect.any(Date))
  })

  it('takes a provider-invisible initial claim before entering the same coordinator gate', async () => {
    const inbound = { takeInitialExecutionClaim: vi.fn(() => null) }
    const runtime = { sendMessage: vi.fn() }
    const coordinator = new ChannelInboundExecutionCoordinator({ inbound: {} as never, delivery: {} as never, cipher: {} as never, runtime: runtime as never })
    await expect(coordinator.executeInitial(inbound as never, 'dispatch-a')).resolves.toBe('deferred')
    expect(inbound.takeInitialExecutionClaim).toHaveBeenCalledWith('dispatch-a')
    expect(runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('admits once, sends one final reply through Delivery, then finalizes the same owner', async () => {
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new TextEncoder().encode('{"text":"hello"}'), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })), finalizeDispatch: vi.fn(() => true),
      renewDispatchLease: vi.fn((value) => value)
    }
    const delivery = { deliverStreamFinal: vi.fn(async () => ({ status: 'delivered' })) }
    const runtime = { sendMessage: vi.fn(async () => ({ assistantMessage: { data: { parts: [{ type: 'text', text: 'final reply' }] } } })) }
    const coordinator = new ChannelInboundExecutionCoordinator({ inbound: inbound as never, delivery: delivery as never, cipher: { decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext } as never, runtime: runtime as never })
    await expect(coordinator.execute(claim)).resolves.toBe('completed')
    expect(runtime.sendMessage).toHaveBeenCalledWith({ agentId: 'agent-a', sessionId: 'session-a', text: 'hello', runId: 'dispatch-a' })
    expect(delivery.deliverStreamFinal).toHaveBeenCalledWith(expect.objectContaining({ executionClaim: claim, source: 'inbound-reply', sourceId: 'dispatch-a' }), ['final reply'])
    expect(inbound.finalizeDispatch).toHaveBeenCalledWith(claim, 'completed', expect.any(Date))
  })

  it('does not deliver or finalize when a lease renewal is fenced during a long runtime', async () => {
    let tick: (() => void) | undefined
    let resolveRuntime: ((value: any) => void) | undefined
    const runtime = { sendMessage: vi.fn(() => new Promise((resolve) => { resolveRuntime = resolve })) }
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new TextEncoder().encode('{"text":"hello"}'), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })),
      renewDispatchLease: vi.fn(() => null), finalizeDispatch: vi.fn(() => true)
    }
    const delivery = { deliverStreamFinal: vi.fn() }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never, delivery: delivery as never, cipher: { decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext } as never,
      runtime: runtime as never, setInterval: (callback) => { tick = callback; return 1 as never }, clearInterval: () => {}
    })
    const pending = coordinator.execute(claim)
    await vi.waitFor(() => expect(resolveRuntime).toBeTypeOf('function'))
    tick?.()
    resolveRuntime?.({ assistantMessage: { data: { parts: [{ type: 'text', text: 'final' }] } } })
    await expect(pending).resolves.toBe('deferred')
    expect(delivery.deliverStreamFinal).not.toHaveBeenCalled()
    expect(inbound.finalizeDispatch).not.toHaveBeenCalled()
  })

  it('fails closed when lease renewal throws during a long runtime', async () => {
    let tick: (() => void) | undefined
    let resolveRuntime: ((value: any) => void) | undefined
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new TextEncoder().encode('{"text":"hello"}'), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })),
      renewDispatchLease: vi.fn(() => { throw new Error('sqlite busy') }), finalizeDispatch: vi.fn(() => true)
    }
    const delivery = { deliverStreamFinal: vi.fn() }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never, delivery: delivery as never, cipher: { decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext } as never,
      runtime: { sendMessage: vi.fn(() => new Promise((resolve) => { resolveRuntime = resolve })) } as never,
      setInterval: (callback) => { tick = callback; return 1 as never }, clearInterval: () => {}
    })
    const pending = coordinator.execute(claim)
    await vi.waitFor(() => expect(resolveRuntime).toBeTypeOf('function'))
    tick?.()
    resolveRuntime?.({ assistantMessage: { data: { parts: [{ type: 'text', text: 'final' }] } } })
    await expect(pending).resolves.toBe('deferred')
    expect(delivery.deliverStreamFinal).not.toHaveBeenCalled()
    expect(inbound.finalizeDispatch).not.toHaveBeenCalled()
  })

  it('uses a renewed owner for a long runtime before its single final delivery', async () => {
    let tick: (() => void) | undefined
    const renewed = { ...claim, leaseExpiresAt: '2026-07-19T01:01:00.000Z' }
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new TextEncoder().encode('{"text":"hello"}'), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })),
      renewDispatchLease: vi.fn(() => renewed), finalizeDispatch: vi.fn(() => true)
    }
    const delivery = { deliverStreamFinal: vi.fn(async () => ({ status: 'delivered' })) }
    let resolveRuntime: ((value: any) => void) | undefined
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never, delivery: delivery as never, cipher: { decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext } as never,
      runtime: { sendMessage: vi.fn(() => new Promise((resolve) => { resolveRuntime = resolve })) } as never,
      setInterval: (callback) => { tick = callback; return 1 as never }, clearInterval: () => {}
    })
    const pending = coordinator.execute(claim)
    await vi.waitFor(() => expect(resolveRuntime).toBeTypeOf('function'))
    tick?.()
    resolveRuntime?.({ assistantMessage: { data: { parts: [{ type: 'text', text: 'final' }] } } })
    await expect(pending).resolves.toBe('completed')
    expect(delivery.deliverStreamFinal).toHaveBeenCalledWith(expect.objectContaining({ executionClaim: renewed }), ['final'])
    expect(inbound.finalizeDispatch).toHaveBeenCalledWith(renewed, 'completed', expect.any(Date))
  })
})
