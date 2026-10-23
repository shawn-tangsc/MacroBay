import { describe, expect, it } from 'vitest'

import type { AgentRuntimeActivityCard } from './agentRuntimeActivityViewModel'
import { resolveAgentRuntimePhaseText } from './agentRuntimePhaseText'

const text = {
  connecting: 'connecting',
  waitingModel: 'waiting-model',
  thinking: 'thinking',
  usingTools: 'using-tools',
  generating: 'generating',
  stopped: 'stopped',
  providerConfigurationRequired: 'provider-required',
  providerRequestFailed: 'request-failed',
  modelRetired: 'model-retired',
  modelNotActivated: 'model-not-activated',
  modelNotFound: 'model-not-found'
}

function card(overrides: Partial<AgentRuntimeActivityCard>): AgentRuntimeActivityCard {
  return {
    key: 'card',
    kind: 'tool',
    title: 'tool',
    status: 'running',
    subtitle: '',
    detail: null,
    approvalId: null,
    toolCallId: null,
    ...overrides
  }
}

describe('resolveAgentRuntimePhaseText', () => {
  it('keeps the initial connecting copy until the first runtime chunk arrives', () => {
    expect(resolveAgentRuntimePhaseText({ phase: 'resolving-context', cards: [], text })).toBeNull()
    expect(resolveAgentRuntimePhaseText({ phase: 'opening-stream', cards: [], text })).toBeNull()
  })

  it('reports thinking while reasoning chunks are running', () => {
    expect(
      resolveAgentRuntimePhaseText({
        phase: 'streaming',
        cards: [card({ kind: 'reasoning', status: 'running' })],
        text
      })
    ).toBe('thinking')
  })

  it('reports tool use while a tool card is active', () => {
    expect(
      resolveAgentRuntimePhaseText({
        phase: 'streaming',
        cards: [card({ kind: 'tool', status: 'running' })],
        text
      })
    ).toBe('using-tools')
  })

  it('reports generation once answer text starts and waits otherwise', () => {
    expect(
      resolveAgentRuntimePhaseText({
        phase: 'streaming',
        cards: [card({ kind: 'assistant-text', status: 'running' })],
        text
      })
    ).toBe('generating')
    expect(resolveAgentRuntimePhaseText({ phase: 'streaming', cards: [], text })).toBe('waiting-model')
  })

  it('does not rewrite terminal phases', () => {
    expect(resolveAgentRuntimePhaseText({ phase: 'finishing', cards: [], text })).toBeNull()
    expect(resolveAgentRuntimePhaseText({ phase: 'pausing', cards: [], text })).toBeNull()
    expect(resolveAgentRuntimePhaseText({ phase: 'idle', cards: [], text })).toBeNull()
  })
})
