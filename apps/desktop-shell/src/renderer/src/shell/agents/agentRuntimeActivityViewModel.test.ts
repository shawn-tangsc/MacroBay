import { describe, expect, it } from 'vitest'

import type {
  AgentRuntimeSessionChunk,
  AgentSessionToolApproval
} from '@platform/ai/agent-platform/runtime/runtimeTypes'

import { agentText } from './agentText'
import { resolveApprovalInputDraft } from './agentRuntimeApprovalInput'
import { buildAgentRuntimeActivityCards } from './agentRuntimeActivityViewModel'

const t = agentText['en-US'].runtimeActivity

describe('agent runtime activity view model', () => {
  it('projects only the active session runtime chunks into display cards', () => {
    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: {
          'session-1': [
            {
              type: 'tool-input-start',
              sessionId: 'session-1',
              toolCallId: 'tool-1',
              toolName: 'Read'
            }
          ],
          'session-2': [
            {
              type: 'runtime-control',
              sessionId: 'session-2',
              runId: 'run-2',
              source: 'claude-agent-sdk',
              subtype: 'status',
              message: 'ignored'
            }
          ]
        },
        toolApprovals: [],
        text: t
      })
    ).toEqual([
      {
        key: 'tool:tool-1',
        kind: 'tool',
        title: 'Read',
        status: 'running',
        subtitle: 'Tool input started',
        detail: null,
        approvalId: null,
        toolCallId: 'tool-1'
      }
    ])
  })

  it('merges pending tool approvals with approval chunks and exposes decision metadata', () => {
    const approval: AgentSessionToolApproval = {
      approvalId: 'approval-1',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      toolName: 'Bash'
    }
    const chunks: AgentRuntimeSessionChunk[] = [
      {
        type: 'tool-approval-request',
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        providerMetadata: {
          claudeAgent: {
            transport: 'claude-agent',
            toolName: 'Bash'
          }
        }
      }
    ]

    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: { 'session-1': chunks },
        toolApprovals: [approval],
        text: t
      })
    ).toEqual([
      {
        key: 'approval:approval-1',
        kind: 'approval',
        title: 'Bash',
        status: 'pending',
        subtitle: 'Waiting for tool approval',
        detail: 'Tool call tool-1',
        approvalId: 'approval-1',
        toolCallId: 'tool-1'
      }
    ])
  })

  it('keeps resolved approval stream events visible after pending approval records disappear', () => {
    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: {
          'session-1': [
            {
              type: 'tool-approval-resolved',
              approvalId: 'approval-1',
              sessionId: 'session-1',
              toolCallId: 'tool-1',
              toolName: 'Bash',
              decision: 'allow',
              updatedInput: { command: 'pwd' }
            },
            {
              type: 'tool-approval-resolved',
              approvalId: 'approval-2',
              sessionId: 'session-1',
              toolCallId: 'tool-2',
              toolName: 'Write',
              decision: 'deny',
              message: 'No write'
            }
          ]
        },
        toolApprovals: [],
        text: t
      })
    ).toEqual([
      {
        key: 'approval:approval-1',
        kind: 'approval',
        title: 'Bash',
        status: 'done',
        subtitle: 'Tool approval allowed',
        detail: '{"command":"pwd"}',
        approvalId: null,
        toolCallId: 'tool-1'
      },
      {
        key: 'approval:approval-2',
        kind: 'approval',
        title: 'Write',
        status: 'denied',
        subtitle: 'Tool approval denied',
        detail: 'No write',
        approvalId: null,
        toolCallId: 'tool-2'
      }
    ])
  })

  it('keeps resolved approval history visible when live approval chunks are gone', () => {
    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: {},
        toolApprovals: [],
        toolApprovalHistory: [
          {
            approvalId: 'approval-1',
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            toolName: 'Bash',
            decision: 'deny',
            message: 'Tool approval was denied because the runtime was disposed.',
            resolvedAt: '2026-07-09T00:00:00.000Z',
            resolutionSource: 'runtime-dispose'
          }
        ],
        text: t
      })
    ).toEqual([
      {
        key: 'approval:approval-1',
        kind: 'approval',
        title: 'Bash',
        status: 'denied',
        subtitle: 'Tool approval denied',
        detail: 'Tool approval was denied because the runtime was disposed.\nResolved at 2026-07-09T00:00:00.000Z',
        approvalId: null,
        toolCallId: 'tool-1'
      }
    ])
  })

  it('attaches matching serializable tool input to pending approvals for editing', () => {
    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: {
          'session-1': [
            {
              type: 'tool-input-available',
              sessionId: 'session-1',
              toolCallId: 'tool-1',
              toolName: 'Bash',
              input: { command: 'mkdir logs', timeout: 1000 }
            },
            {
              type: 'tool-approval-request',
              approvalId: 'approval-1',
              sessionId: 'session-1',
              toolCallId: 'tool-1',
              providerMetadata: {
                claudeAgent: {
                  transport: 'claude-agent',
                  toolName: 'Bash'
                }
              }
            }
          ]
        },
        toolApprovals: [
          {
            approvalId: 'approval-1',
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            toolName: 'Bash'
          }
        ],
        text: t
      }).find((card) => card.kind === 'approval')
    ).toMatchObject({
      key: 'approval:approval-1',
      approvalId: 'approval-1',
      toolCallId: 'tool-1',
      approvalInputText: '{\n  "command": "mkdir logs",\n  "timeout": 1000\n}'
    })
  })

  it('resolves edited approval input drafts only when valid JSON changed', () => {
    const original = '{\n  "command": "mkdir logs"\n}'

    expect(resolveApprovalInputDraft(original, original)).toEqual({ kind: 'original' })
    expect(resolveApprovalInputDraft(original, '   ')).toEqual({ kind: 'original' })
    expect(resolveApprovalInputDraft(original, '{ "command": "mkdir logs", "timeout": 1000 }')).toEqual({
      kind: 'updated',
      updatedInput: { command: 'mkdir logs', timeout: 1000 }
    })
    expect(resolveApprovalInputDraft(original, '{ bad json')).toEqual({
      kind: 'invalid'
    })
  })

  it('summarizes tool lifecycle into one card per tool call', () => {
    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: {
          'session-1': [
            {
              type: 'tool-input-available',
              sessionId: 'session-1',
              toolCallId: 'tool-1',
              toolName: 'Write',
              input: { path: '/tmp/a.txt', content: 'hello' }
            },
            {
              type: 'tool-output-available',
              sessionId: 'session-1',
              toolCallId: 'tool-1',
              output: { ok: true }
            }
          ]
        },
        toolApprovals: [],
        text: t
      })
    ).toEqual([
      {
        key: 'tool:tool-1',
        kind: 'tool',
        title: 'Write',
        status: 'done',
        subtitle: '/tmp/a.txt',
        detail: '{"ok":true}',
        approvalId: null,
        toolCallId: 'tool-1',
        requestDetail: '{\n  "path": "/tmp/a.txt",\n  "content": "hello"\n}'
      }
    ])
  })

  it('groups reasoning deltas and assistant text updates by runtime run', () => {
    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: {
          'session-1': [
            {
              type: 'reasoning-start',
              sessionId: 'session-1',
              runId: 'run-1',
              partId: 'part-1'
            },
            {
              type: 'reasoning-delta',
              sessionId: 'session-1',
              runId: 'run-1',
              partId: 'part-1',
              delta: 'thinking '
            },
            {
              type: 'reasoning-delta',
              sessionId: 'session-1',
              runId: 'run-1',
              partId: 'part-1',
              delta: 'ahead'
            },
            {
              type: 'assistant-text-update',
              sessionId: 'session-1',
              runId: 'run-1',
              text: 'final visible draft',
              textDelta: 'draft',
              mode: 'replace'
            }
          ]
        },
        toolApprovals: [],
        text: t
      })
    ).toEqual([
      {
        key: 'reasoning:run-1:part-1',
        kind: 'reasoning',
        title: 'Reasoning',
        status: 'running',
        subtitle: 'Reasoning in progress',
        detail: 'thinking ahead',
        approvalId: null,
        toolCallId: null
      },
      {
        key: 'assistant-text:run-1',
        kind: 'assistant-text',
        title: 'Live response',
        status: 'running',
        subtitle: 'Streaming text',
        detail: 'final visible draft',
        approvalId: null,
        toolCallId: null
      }
    ])
  })

  it('keeps runtime control messages and denied tool output visible', () => {
    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: {
          'session-1': [
            {
              type: 'runtime-control',
              sessionId: 'session-1',
              runId: 'run-1',
              source: 'claude-agent-sdk',
              subtype: 'api_retry',
              message: 'Retrying provider request'
            },
            {
              type: 'tool-output-denied',
              sessionId: 'session-1',
              toolCallId: 'tool-1',
              message: 'User denied'
            }
          ]
        },
        toolApprovals: [],
        text: t
      })
    ).toEqual([
      {
        key: 'control:run-1:api_retry',
        kind: 'control',
        title: 'api_retry',
        status: 'done',
        subtitle: 'Runtime control event',
        detail: 'Retrying provider request',
        approvalId: null,
        toolCallId: null
      },
      {
        key: 'tool:tool-1',
        kind: 'tool',
        title: 'tool-1',
        status: 'denied',
        subtitle: 'Tool denied',
        detail: 'User denied',
        approvalId: null,
        toolCallId: 'tool-1'
      }
    ])
  })

  it('hides quiet Claude SDK runtime control telemetry from the live activity panel', () => {
    expect(
      buildAgentRuntimeActivityCards({
        sessionId: 'session-1',
        chunksBySessionId: {
          'session-1': [
            {
              type: 'runtime-control',
              sessionId: 'session-1',
              runId: 'run-1',
              source: 'claude-agent-sdk',
              subtype: 'thinking_tokens'
            },
            {
              type: 'runtime-control',
              sessionId: 'session-1',
              runId: 'run-1',
              source: 'claude-agent-sdk',
              subtype: 'compact_boundary'
            },
            {
              type: 'runtime-control',
              sessionId: 'session-1',
              runId: 'run-1',
              source: 'claude-agent-sdk',
              subtype: 'api_retry',
              message: 'Retrying provider request'
            }
          ]
        },
        toolApprovals: [],
        text: t
      })
    ).toEqual([
      {
        key: 'control:run-1:api_retry',
        kind: 'control',
        title: 'api_retry',
        status: 'done',
        subtitle: 'Runtime control event',
        detail: 'Retrying provider request',
        approvalId: null,
        toolCallId: null
      }
    ])
  })

  it('renders a known product write as labelled request parameters', () => {
    const card = buildAgentRuntimeActivityCards({
      sessionId: 'session-1',
      chunksBySessionId: {
        'session-1': [
          {
            type: 'tool-input-available',
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            toolName: 'mcp__market-intelligence__configure_intelligence_source',
            input: {
              action: 'set-enabled',
              sourceId: 'coingecko-trending',
              enabled: true
            }
          },
          {
            type: 'tool-approval-request',
            approvalId: 'approval-1',
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            providerMetadata: {
              claudeAgent: {
                transport: 'claude-agent',
                toolName: 'mcp__market-intelligence__configure_intelligence_source'
              }
            }
          }
        ]
      },
      toolApprovals: [],
      text: t
    }).find((entry) => entry.kind === 'approval')

    expect(card).toMatchObject({
      approvalId: 'approval-1',
      approvalNotice: t.approvalRequestParamsNotice,
      approvalFields: [
        { label: 'Action', value: 'set-enabled' },
        { label: 'Source', value: 'coingecko-trending' },
        { label: 'Enabled', value: 'true' }
      ]
    })
    expect(card?.approvalInputText).toContain('"sourceId": "coingecko-trending"')
  })

  it('falls back to the existing summary when a known capability carries an unlabelled field', () => {
    const card = buildAgentRuntimeActivityCards({
      sessionId: 'session-1',
      chunksBySessionId: {
        'session-1': [
          {
            type: 'tool-input-available',
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            toolName: 'mcp__market-intelligence__configure_intelligence_source',
            input: { action: 'set-enabled', mysteryField: 'kept' }
          },
          {
            type: 'tool-approval-request',
            approvalId: 'approval-1',
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            providerMetadata: {
              claudeAgent: {
                transport: 'claude-agent',
                toolName: 'mcp__market-intelligence__configure_intelligence_source'
              }
            }
          }
        ]
      },
      toolApprovals: [],
      text: t
    }).find((entry) => entry.kind === 'approval')

    expect(card?.approvalFields).toBeUndefined()
    expect(card?.approvalNotice).toBeUndefined()
    expect(card?.approvalInputText).toContain('"mysteryField": "kept"')
  })

  it('falls back to the existing summary for an unknown capability', () => {
    const card = buildAgentRuntimeActivityCards({
      sessionId: 'session-1',
      chunksBySessionId: {
        'session-1': [
          {
            type: 'tool-input-available',
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            toolName: 'Bash',
            input: { command: 'ls' }
          },
          {
            type: 'tool-approval-request',
            approvalId: 'approval-1',
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            providerMetadata: {
              claudeAgent: {
                transport: 'claude-agent',
                toolName: 'Bash'
              }
            }
          }
        ]
      },
      toolApprovals: [],
      text: t
    }).find((entry) => entry.kind === 'approval')

    expect(card?.approvalFields).toBeUndefined()
    expect(card?.approvalNotice).toBeUndefined()
    expect(card?.approvalInputText).toContain('"command": "ls"')
  })
})
