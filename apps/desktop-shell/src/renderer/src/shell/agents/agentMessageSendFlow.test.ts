import { describe, expect, it, vi } from 'vitest'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { sendAgentSessionMessage } from './agentMessageSendFlow'

describe('agent message send flow', () => {
  it('clears the draft after send starts and applies the returned state on success', async () => {
    const nextState = { activeSessionId: 'session-1' } as AgentStoreState
    const callbacks = createCallbacks()
    const platform = {
      agents: {
        sendMessage: vi.fn(async () => ({ state: nextState })),
        getState: vi.fn()
      }
    } as unknown as Window['platform']

    await sendAgentSessionMessage({
      platform,
      request: {
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'hello',
        runId: 'run-1'
      },
      ...callbacks
    })

    expect(platform.agents.sendMessage).toHaveBeenCalledWith({
      agentId: 'agent-1',
      sessionId: 'session-1',
      text: 'hello',
      runId: 'run-1'
    })
    expect(callbacks.clearDraft).toHaveBeenCalled()
    expect(callbacks.clearFiles).toHaveBeenCalled()
    expect(callbacks.restoreDraft).not.toHaveBeenCalled()
    expect(callbacks.restoreFiles).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenLastCalledWith(null)
    expect(callbacks.resolveState()).toBe(nextState)
  })

  it('restores the draft and exposes the IPC error when send fails before state is returned', async () => {
    const latestState = { activeSessionId: 'session-1' } as AgentStoreState
    const callbacks = createCallbacks()
    const platform = {
      agents: {
        sendMessage: vi.fn(async () => {
          throw new Error('Claude Code provider is not ready.')
        }),
        getState: vi.fn(async () => latestState)
      }
    } as unknown as Window['platform']

    await sendAgentSessionMessage({
      platform,
      request: {
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: '你好',
        runId: 'run-1'
      },
      ...callbacks
    })

    expect(callbacks.clearDraft).toHaveBeenCalled()
    expect(callbacks.clearFiles).toHaveBeenCalled()
    expect(callbacks.restoreDraft).toHaveBeenCalled()
    expect(callbacks.restoreFiles).toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenLastCalledWith('Claude Code provider is not ready.')
    expect(callbacks.resolveState()).toBe(latestState)
  })

  it('restores the draft when send returns without a persisted submitted message', async () => {
    const latestState = { messagesBySessionId: { 'session-1': [] } } as unknown as AgentStoreState
    const callbacks = createCallbacks()
    const platform = {
      agents: {
        sendMessage: vi.fn(async () => ({})),
        getState: vi.fn(async () => latestState)
      }
    } as unknown as Window['platform']

    await sendAgentSessionMessage({
      platform,
      request: {
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'hello',
        runId: 'run-1'
      },
      ...callbacks
    })

    expect(callbacks.restoreDraft).toHaveBeenCalled()
    expect(callbacks.restoreFiles).toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenLastCalledWith('Agent runtime did not return an updated state.')
    expect(callbacks.resolveState()).toBe(latestState)
  })

  it('keeps the draft cleared when send errors after the submitted message was persisted', async () => {
    const latestState = {
      messagesBySessionId: {
        'session-1': [
          {
            role: 'user',
            searchableText: 'hello'
          }
        ]
      }
    } as unknown as AgentStoreState
    const callbacks = createCallbacks()
    const platform = {
      agents: {
        sendMessage: vi.fn(async () => {
          throw new Error('Renderer bridge lost the reply.')
        }),
        getState: vi.fn(async () => latestState)
      }
    } as unknown as Window['platform']

    await sendAgentSessionMessage({
      platform,
      request: {
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'hello',
        runId: 'run-1'
      },
      ...callbacks
    })

    expect(callbacks.restoreDraft).not.toHaveBeenCalled()
    expect(callbacks.restoreFiles).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenLastCalledWith(null)
    expect(callbacks.resolveState()).toBe(latestState)
  })

  it('recognizes a persisted submitted message that also contains mentioned-model metadata', async () => {
    const latestState = {
      messagesBySessionId: {
        'session-1': [
          {
            role: 'user',
            searchableText: 'Mentioned models:\n- Chat Model (Provider 1) [provider-1:chat-model]\n\nhello',
            data: {
              parts: [
                {
                  type: 'agent-mentioned-models',
                  modelIds: ['provider-1:chat-model'],
                  models: [
                    {
                      id: 'provider-1:chat-model',
                      label: 'Chat Model',
                      providerName: 'Provider 1'
                    }
                  ]
                },
                {
                  type: 'text',
                  text: 'hello'
                }
              ]
            }
          }
        ]
      }
    } as unknown as AgentStoreState
    const callbacks = createCallbacks()
    const platform = {
      agents: {
        sendMessage: vi.fn(async () => {
          throw new Error('Renderer bridge lost the reply.')
        }),
        getState: vi.fn(async () => latestState)
      }
    } as unknown as Window['platform']

    await sendAgentSessionMessage({
      platform,
      request: {
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'hello',
        mentionedModels: [
          {
            id: 'provider-1:chat-model',
            label: 'Chat Model',
            providerName: 'Provider 1'
          }
        ],
        runId: 'run-1'
      },
      ...callbacks
    })

    expect(callbacks.restoreDraft).not.toHaveBeenCalled()
    expect(callbacks.restoreFiles).not.toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenLastCalledWith(null)
    expect(callbacks.resolveState()).toBe(latestState)
  })

  it('restores the draft even when both send and state refresh fail', async () => {
    const callbacks = createCallbacks()
    const platform = {
      agents: {
        sendMessage: vi.fn(async () => {
          throw new Error('Agent runtime is not available.')
        }),
        getState: vi.fn(async () => {
          throw new Error('State bridge is not available.')
        })
      }
    } as unknown as Window['platform']

    await sendAgentSessionMessage({
      platform,
      request: {
        agentId: 'agent-1',
        sessionId: 'session-1',
        text: 'hello',
        runId: 'run-1'
      },
      ...callbacks
    })

    expect(callbacks.restoreDraft).toHaveBeenCalled()
    expect(callbacks.restoreFiles).toHaveBeenCalled()
    expect(callbacks.onError).toHaveBeenLastCalledWith('Agent runtime is not available.')
    expect(callbacks.resolveState()).toBeNull()
  })
})

function createCallbacks(): Omit<
  Parameters<typeof sendAgentSessionMessage>[0],
  'platform' | 'request'
> & {
  resolveState: () => AgentStoreState | null
} {
  let resolvedState: AgentStoreState | null = null
  return {
    clearDraft: vi.fn(),
    restoreDraft: vi.fn(),
    clearFiles: vi.fn(),
    restoreFiles: vi.fn(),
    resetTextarea: vi.fn(),
    onError: vi.fn(),
    onStateChange: vi.fn((updater: (state: AgentStoreState) => AgentStoreState) => {
      resolvedState = updater({} as AgentStoreState)
    }),
    resolveState: () => resolvedState
  }
}
