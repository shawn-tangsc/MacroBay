import { describe, expect, it } from 'vitest'

import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { groupAgentSessionMessages } from '@platform/ui/agent-chat'
import { buildAgentMessageVirtualHeightCache, buildAgentMessageVirtualItems } from './agentMessageVirtualItems'

function message(input: Partial<AgentSessionMessageEntity> & Pick<AgentSessionMessageEntity, 'id' | 'role'>): AgentSessionMessageEntity {
  return {
    id: input.id,
    sessionId: input.sessionId ?? 'session-1',
    role: input.role,
    data: input.data ?? { parts: [] },
    searchableText: input.searchableText ?? '',
    status: input.status ?? 'success',
    modelId: null,
    modelSnapshot: null,
    stats: null,
    runtimeResumeToken: null,
    createdAt: input.createdAt ?? '2026-07-09T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-07-09T00:00:00.000Z'
  }
}

describe('agent message virtual items', () => {
  it('uses content-aware estimates for grouped messages', () => {
    const groups = groupAgentSessionMessages([
      message({
        id: 'm1',
        role: 'assistant',
        searchableText: 'short',
        data: { parts: [{ type: 'text', text: 'short' }] }
      }),
      message({
        id: 'm2',
        role: 'assistant',
        searchableText: 'x'.repeat(420),
        data: { parts: [{ type: 'text', text: 'x'.repeat(420) }] }
      })
    ])

    const items = buildAgentMessageVirtualItems(groups, {
      fontSize: 14,
      messageStyle: 'plain',
      narrowMode: false
    })

    expect(items).toHaveLength(1)
    expect(items[0]?.estimatedHeight).toBeGreaterThan(220)
  })

  it('estimates narrow layouts taller than wide layouts for the same text', () => {
    const groups = groupAgentSessionMessages([
      message({
        id: 'm1',
        role: 'assistant',
        searchableText: 'x'.repeat(320),
        data: { parts: [{ type: 'text', text: 'x'.repeat(320) }] }
      })
    ])

    const [wideItem] = buildAgentMessageVirtualItems(groups, {
      fontSize: 14,
      messageStyle: 'plain',
      narrowMode: false
    })
    const [narrowItem] = buildAgentMessageVirtualItems(groups, {
      fontSize: 14,
      messageStyle: 'plain',
      narrowMode: true
    })

    expect(narrowItem?.estimatedHeight).toBeGreaterThan(wideItem?.estimatedHeight ?? 0)
  })

  it('estimates runtime error details taller than normal runtime summaries', () => {
    const baseGroup = groupAgentSessionMessages([
      message({
        id: 'm1',
        role: 'assistant',
        data: {
          parts: [{ type: 'claude-sdk-tool-result', toolCallId: 'call-1', output: 'ok', isError: false }]
        }
      })
    ])
    const errorGroup = groupAgentSessionMessages([
      message({
        id: 'm2',
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'claude-sdk-tool-result',
              toolCallId: 'call-2',
              isError: true,
              errorText: 'something went wrong\nand surfaced more detail here'
            }
          ]
        }
      })
    ])

    const [baseItem] = buildAgentMessageVirtualItems(baseGroup, null)
    const [errorItem] = buildAgentMessageVirtualItems(errorGroup, null)

    expect(errorItem?.estimatedHeight).toBeGreaterThan(baseItem?.estimatedHeight ?? 0)
  })

  it('does not count quiet Claude SDK runtime-control telemetry as visible runtime blocks', () => {
    const plainGroup = groupAgentSessionMessages([
      message({
        id: 'plain',
        role: 'assistant',
        searchableText: 'Done',
        data: { parts: [{ type: 'text', text: 'Done' }] }
      })
    ])
    const telemetryGroup = groupAgentSessionMessages([
      message({
        id: 'telemetry',
        role: 'assistant',
        searchableText: 'Done',
        data: {
          parts: [
            { type: 'text', text: 'Done' },
            ...Array.from({ length: 12 }, () => ({
              type: 'claude-sdk-runtime-control',
              source: 'claude-agent-sdk',
              subtype: 'thinking_tokens'
            }))
          ]
        }
      })
    ])

    const [plainItem] = buildAgentMessageVirtualItems(plainGroup, null)
    const [telemetryItem] = buildAgentMessageVirtualItems(telemetryGroup, null)

    expect(telemetryItem?.estimatedHeight).toBe(plainItem?.estimatedHeight)
  })

  it('estimates attachment-heavy tool results taller than plain text groups', () => {
    const plainGroup = groupAgentSessionMessages([
      message({
        id: 'm1',
        role: 'assistant',
        searchableText: 'plain result',
        data: { parts: [{ type: 'text', text: 'plain result' }] }
      })
    ])
    const attachmentHeavyGroup = groupAgentSessionMessages([
      message({
        id: 'm2',
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'claude-sdk-tool-result',
              toolCallId: 'tool-media',
              isError: false,
              structuredContent: { rows: Array.from({ length: 6 }, (_, index) => ({ index, ok: true })) },
              content: [
                { type: 'text', text: 'Generated report with media.' },
                { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
                { type: 'resource', resource: { uri: 'file:///tmp/report.csv', text: 'csv body'.repeat(40) } }
              ],
              output: 'done'
            }
          ]
        }
      })
    ])

    const [plainItem] = buildAgentMessageVirtualItems(plainGroup, null)
    const [attachmentItem] = buildAgentMessageVirtualItems(attachmentHeavyGroup, null)

    expect(attachmentItem?.estimatedHeight).toBeGreaterThan((plainItem?.estimatedHeight ?? 0) + 120)
  })

  it('uses distinct measured profiles for attachment-heavy tool results', () => {
    const groups = groupAgentSessionMessages([
      message({
        id: 'm1',
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'claude-sdk-tool-result',
              toolCallId: 'tool-1',
              isError: false,
              content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }]
            }
          ]
        }
      }),
      message({
        id: 'm2',
        role: 'user',
        searchableText: 'break',
        data: { parts: [{ type: 'text', text: 'break' }] }
      }),
      message({
        id: 'm3',
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'claude-sdk-tool-result',
              toolCallId: 'tool-2',
              isError: false,
              content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }]
            }
          ]
        }
      })
    ])

    const cache = buildAgentMessageVirtualHeightCache(groups, { m1: 360 }, null)
    const items = buildAgentMessageVirtualItems(groups, null, cache)

    expect(items[0]?.estimatedHeight).toBe(360)
    expect(items[2]?.estimatedHeight).toBe(360)
  })

  it('estimates file artifact rows taller than plain text groups', () => {
    const plainGroup = groupAgentSessionMessages([
      message({
        id: 'm1',
        role: 'assistant',
        searchableText: 'done',
        data: { parts: [{ type: 'text', text: 'done' }] }
      })
    ])
    const fileArtifactGroup = groupAgentSessionMessages([
      message({
        id: 'm2',
        role: 'assistant',
        data: {
          parts: [
            { type: 'text', text: 'done' },
            {
              type: 'claude-sdk-tool-call',
              toolCallId: 'write-1',
              toolName: 'Write',
              input: { file_path: '/Users/demo/project/hello.py', content: 'print("hi")' }
            },
            {
              type: 'claude-sdk-tool-call',
              toolCallId: 'edit-1',
              toolName: 'Edit',
              input: { file_path: '/Users/demo/project/notes/agent-platform.md', old_string: 'a', new_string: 'b' }
            }
          ]
        }
      })
    ])

    const [plainItem] = buildAgentMessageVirtualItems(plainGroup, null)
    const [fileItem] = buildAgentMessageVirtualItems(fileArtifactGroup, null)

    expect(fileItem?.estimatedHeight).toBeGreaterThan((plainItem?.estimatedHeight ?? 0) + 150)
  })

  it('reuses averaged measured heights for similar unmeasured groups', () => {
    const groups = groupAgentSessionMessages([
      message({
        id: 'm1',
        role: 'assistant',
        searchableText: 'x'.repeat(180),
        data: { parts: [{ type: 'text', text: 'x'.repeat(180) }] }
      }),
      message({
        id: 'm2',
        role: 'user',
        searchableText: 'break',
        data: { parts: [{ type: 'text', text: 'break' }] }
      }),
      message({
        id: 'm3',
        role: 'assistant',
        searchableText: 'x'.repeat(185),
        data: { parts: [{ type: 'text', text: 'x'.repeat(185) }] }
      }),
      message({
        id: 'm4',
        role: 'user',
        searchableText: 'break again',
        data: { parts: [{ type: 'text', text: 'break again' }] }
      }),
      message({
        id: 'm5',
        role: 'assistant',
        searchableText: 'x'.repeat(190),
        data: { parts: [{ type: 'text', text: 'x'.repeat(190) }] }
      })
    ])

    const settings = {
      fontSize: 14,
      messageStyle: 'plain' as const,
      narrowMode: false
    }
    const cache = buildAgentMessageVirtualHeightCache(
      groups,
      {
        m1: 220,
        m3: 260
      },
      settings
    )
    const items = buildAgentMessageVirtualItems(groups, settings, cache)

    expect(items[0]?.estimatedHeight).toBe(240)
    expect(items[2]?.estimatedHeight).toBe(240)
    expect(items[4]?.estimatedHeight).toBe(240)
  })
})
