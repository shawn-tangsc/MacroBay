import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import AgentSessionUsageBar from './AgentSessionUsageBar'
import { AgentTextProvider } from '../agentTextProvider'

const message: AgentSessionMessageEntity = {
  id: 'assistant-1',
  sessionId: 'session-1',
  role: 'assistant',
  data: { parts: [] },
  searchableText: '',
  status: 'success',
  modelId: null,
  modelSnapshot: null,
  stats: { promptTokens: 1200, completionTokens: 208, totalTokens: 1408 },
  runtimeResumeToken: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('AgentSessionUsageBar', () => {
  it('renders the session total and input/output breakdown', () => {
    const markup = renderToStaticMarkup(
      <AgentTextProvider language="en-US">
        <AgentSessionUsageBar messages={[message]} />
      </AgentTextProvider>
    )

    expect(markup).toContain('Token usage 1,408')
    expect(markup).toContain('Input 1,200')
    expect(markup).toContain('Output 208')
  })
})
