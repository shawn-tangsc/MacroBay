import { describe, expect, it, vi } from 'vitest'

import { ChannelInboundExecutionCoordinator } from './ChannelInboundExecutionCoordinator'
import { isChannelSession, resetChannelSessions } from '../runtime/channelToolApproval'

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

  it('sends a localized failure notice when the Agent rejects', async () => {
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new TextEncoder().encode('{"text":"hello"}'), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })),
      finalizeDispatch: vi.fn(() => true),
      renewDispatchLease: vi.fn((value) => value)
    }
    const delivery = { deliverStreamFinal: vi.fn(async () => ({ status: 'delivered' })) }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never, delivery: delivery as never,
      cipher: { decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext } as never,
      runtime: { sendMessage: vi.fn(async () => { throw new Error('provider down') }) } as never,
      failureText: () => '处理失败，请稍后重试。'
    })
    await expect(coordinator.execute(claim)).resolves.toBe('failed')
    expect(delivery.deliverStreamFinal).toHaveBeenCalledWith(expect.objectContaining({ text: '处理失败，请稍后重试。' }), ['处理失败，请稍后重试。'])
  })

  it('marks the session as a phone channel before the very first turn after a restart', async () => {
    // 重启场景：进程内的「手机通道」标记是空的，靠的是**每次分发前重新标记**。
    resetChannelSessions()
    const seen: boolean[] = []
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new TextEncoder().encode('{"text":"hi"}'), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-restarted' })),
      finalizeDispatch: vi.fn(() => true),
      renewDispatchLease: vi.fn((value) => value),
      dispatchConversationId: vi.fn(() => 'conversation-a')
    }
    const runs = { get: vi.fn(() => null), start: vi.fn(() => true), complete: vi.fn(), markResult: vi.fn() }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never,
      delivery: { deliverStreamFinal: vi.fn(async () => ({ status: 'delivered' })) } as never,
      cipher: {
        decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext,
        encrypt: async () => ({ ciphertext: new Uint8Array([1]), keyRef: 'ref', keyRevision: 1 })
      } as never,
      runtime: {
        sendMessage: vi.fn(async () => {
          // 分发那一刻必须已经标记：否则这一轮的审批又会进「等界面」队列。
          seen.push(isChannelSession('session-restarted'))
          return { assistantMessage: { data: { parts: [{ type: 'text', text: 'ok' }] } }, state: {} }
        })
      } as never,
      runs: runs as never
    })

    await expect(coordinator.execute(claim)).resolves.toBe('completed')
    expect(seen).toEqual([true])
    resetChannelSessions()
  })

  it('records the real failure reason and names it to the reader', async () => {
    const runs = { get: vi.fn(() => null), fail: vi.fn(), start: vi.fn(() => true) }
    const failureText = vi.fn(() => '这个对话绑的会话还属上一个助手，下一条消息会自动换过来。')
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new TextEncoder().encode('{"text":"hi"}'), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })),
      finalizeDispatch: vi.fn(() => true),
      renewDispatchLease: vi.fn((value) => value),
      dispatchConversationId: vi.fn(() => 'conversation-a')
    }
    const delivery = { deliverStreamFinal: vi.fn(async () => ({ status: 'delivered' })) }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never, delivery: delivery as never,
      cipher: { decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext } as never,
      runtime: { sendMessage: vi.fn(async () => { throw new Error('Session "s" does not belong to agent "agent-a".') }) } as never,
      runs: runs as never,
      failureText
    })

    await expect(coordinator.execute(claim)).resolves.toBe('failed')

    // 原因进台账（闭集码 + 脱敏说明），不再是只有 status。
    expect(runs.fail).toHaveBeenCalledWith('dispatch-a', 'failed', expect.any(Date), {
      code: 'dispatch-session-agent-mismatch',
      detail: 'Session "s" does not belong to agent "agent-a".'
    })
    // 回给读者的话按原因给，不是套话。
    expect(failureText).toHaveBeenCalledWith('run-failed', 'dispatch-session-agent-mismatch')
    expect(delivery.deliverStreamFinal).toHaveBeenCalledWith(
      expect.objectContaining({ text: '这个对话绑的会话还属上一个助手，下一条消息会自动换过来。' }),
      ['这个对话绑的会话还属上一个助手，下一条消息会自动换过来。']
    )
  })

  it('runs two dispatches for one conversation one after another, never at the same time', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const runs = { get: vi.fn(() => null), start: vi.fn(() => true), complete: vi.fn(), markResult: vi.fn() }
    const inbound = {
      admitDispatch: vi.fn(() => ({ ...claim, conversationId: 'conversation-a', ciphertext: new TextEncoder().encode('{"text":"hi"}'), keyRef: 'ref', keyRevision: 1 })),
      getConversationBinding: vi.fn(() => ({ agentId: 'agent-a', sessionId: 'session-a' })),
      finalizeDispatch: vi.fn(() => true),
      renewDispatchLease: vi.fn((value) => value),
      dispatchConversationId: vi.fn(() => 'conversation-a')
    }
    const delivery = { deliverStreamFinal: vi.fn(async () => ({ status: 'delivered' })) }
    const coordinator = new ChannelInboundExecutionCoordinator({
      inbound: inbound as never, delivery: delivery as never,
      cipher: {
        decrypt: async (input: { ciphertext: Uint8Array }) => input.ciphertext,
        encrypt: async () => ({ ciphertext: new Uint8Array([1]), keyRef: 'ref', keyRevision: 1 })
      } as never,
      runtime: {
        sendMessage: vi.fn(async () => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise((resolve) => { setTimeout(resolve, 10) })
          inFlight -= 1
          return { assistantMessage: { data: { parts: [{ type: 'text', text: 'ok' }] } }, state: {} }
        })
      } as never,
      runs: runs as never
    })

    const [first, second] = await Promise.all([
      coordinator.execute({ ...claim, dispatchId: 'dispatch-1' }),
      coordinator.execute({ ...claim, dispatchId: 'dispatch-2' })
    ])

    expect(maxInFlight).toBe(1)
    expect([first, second]).toEqual(['completed', 'completed'])
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
