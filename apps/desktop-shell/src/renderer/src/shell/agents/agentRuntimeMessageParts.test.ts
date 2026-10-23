import { describe, expect, it } from 'vitest'

import { agentText } from './agentText'
import { buildAgentRuntimeMessagePartBlocks } from './agentRuntimeMessageParts'

const text = {
  messages: agentText['en-US'].messages,
  runtimeActivity: agentText['en-US'].runtimeActivity,
  runtimeText: agentText['en-US'].runtimeText,
  input: agentText['en-US'].input
}

describe('agent runtime message parts view model', () => {
  it('replaces the persisted connecting placeholder with the live runtime phase copy', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          {
            type: 'runtime-text',
            key: 'agent.runtime.connecting',
            fallback: 'Connecting to the model service...',
            text: 'Connecting to the model service...'
          }
        ],
        text,
        { runtimeTextOverride: 'Thinking...' }
      )
    ).toEqual([{ key: 'runtime-text:0', kind: 'text', text: 'Thinking...' }])
  })

  it('projects a readable message context before the question text', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          {
            type: 'agent-context',
            kind: 'market-analysis-node',
            label: '10-23 16:25 分析结论',
            detail: '10月制造业 PMI（初值）',
            payload: { eventGroupId: 'mi-eg-1' }
          },
          { type: 'text', text: '给我分析一下这个结论' }
        ],
        text
      ).map((block) => [block.kind, block.kind === 'context' ? block.part.label : block.kind === 'text' ? block.text : ''])
    ).toEqual([
      ['context', '10-23 16:25 分析结论'],
      ['text', '给我分析一下这个结论']
    ])
  })

  it('hides a legacy raw analysis reference behind a readable context card', () => {
    const blocks = buildAgentRuntimeMessagePartBlocks(
      [{
        type: 'text',
        text: '给我分析一下这个结论\n\n[eventGroupId=eg-1; analysisRunId=ar-1; summaryId=as-1; asOf=2026-10-23T08:22:42.452Z]'
      }],
      text
    )

    expect(blocks.map((block) => block.kind)).toEqual(['context', 'text'])
    expect(blocks[0]).toMatchObject({
      kind: 'context',
      part: { kind: 'legacy-analysis-reference', label: 'Quoted analysis', payload: { eventGroupId: 'eg-1' } }
    })
    expect(blocks[1]).toMatchObject({ kind: 'text', text: '给我分析一下这个结论' })
  })

  it('keeps plain text visible and hides mentioned model metadata', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          { type: 'text', text: 'Final answer.' },
          { type: 'agent-mentioned-models', modelIds: [], models: [] }
        ],
        text
      )
    ).toEqual([
      {
        key: 'text:0',
        kind: 'text',
        text: 'Final answer.'
      }
    ])
  })

  it('projects persisted Claude SDK reasoning parts into compact runtime blocks', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          {
            type: 'claude-sdk-reasoning',
            source: 'claude-agent-sdk',
            partId: 'reasoning-1',
            text: 'Plan first.'
          }
        ],
        text
      )
    ).toEqual([
      {
        key: 'claude-reasoning:reasoning-1:0',
        kind: 'runtime',
        runtimeKind: 'reasoning',
        title: 'Processed',
        subtitle: 'Reasoning completed',
        status: 'done',
        detail: 'Plan first.'
      }
    ])
  })

  it('places compact runtime blocks before the final answer text for transcript flow', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          { type: 'text', text: '**Final answer**\n\n- item' },
          {
            type: 'claude-sdk-reasoning',
            source: 'claude-agent-sdk',
            partId: 'reasoning-1',
            text: 'Plan first.'
          }
        ],
        text
      ).map((block) => [block.kind, block.key])
    ).toEqual([
      ['runtime', 'claude-reasoning:reasoning-1:1'],
      ['text', 'text:0']
    ])
  })

  it('projects persisted Claude SDK tool calls and tool results into runtime blocks', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          {
            type: 'claude-sdk-tool-call',
            source: 'claude-agent-sdk',
            toolCallId: 'tool-1',
            toolName: 'WebSearch',
            input: { query: 'agent runtime' }
          },
          {
            type: 'claude-sdk-tool-result',
            source: 'claude-agent-sdk',
            toolCallId: 'tool-1',
            output: 'Human readable result',
            content: [{ type: 'text', text: 'Human readable result' }],
            structuredContent: { ok: true, count: 2 },
            isError: false
          },
          {
            type: 'claude-sdk-tool-result',
            source: 'claude-agent-sdk',
            toolCallId: 'tool-2',
            errorText: 'Permission denied',
            isError: true
          }
        ],
        text
      )
    ).toEqual([
      {
        key: 'claude-tool:tool-1:0',
        kind: 'runtime',
        runtimeKind: 'tool-call',
        title: 'WebSearch',
        subtitle: 'agent runtime',
        status: 'done',
        detail: '{\n  "ok": true,\n  "count": 2\n}',
        requestDetail: '{\n  "query": "agent runtime"\n}',
        details: [
          {
            label: 'Structured content',
            text: '{\n  "ok": true,\n  "count": 2\n}'
          },
          {
            label: 'Content',
            text: 'Human readable result',
            items: [
              {
                kind: 'text',
                title: 'text',
                text: 'Human readable result'
              }
            ]
          }
        ],
        resultCards: [
          {
            key: 'content:0',
            kind: 'text',
            title: 'Text',
            text: 'Human readable result'
          }
        ]
      },
      {
        key: 'claude-tool-result:tool-2:2',
        kind: 'runtime',
        runtimeKind: 'tool-result',
        title: 'tool-2',
        subtitle: 'Tool failed',
        status: 'error',
        detail: 'Permission denied',
        resultCards: [
          {
            key: 'error:0',
            kind: 'error',
            title: 'Error',
            text: 'Permission denied'
          }
        ]
      }
    ])
  })

  it('summarizes multi-block tool result content without dumping raw JSON first', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          {
            type: 'claude-sdk-tool-result',
            source: 'claude-agent-sdk',
            toolCallId: 'tool-media',
            content: [
              { type: 'text', text: 'Chart generated.' },
              { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
              { type: 'resource', resource: { uri: 'file:///tmp/report.txt', text: 'Report body' } }
            ],
            isError: false
          }
        ],
        text
      )
    ).toEqual([
      {
        key: 'claude-tool-result:tool-media:0',
        kind: 'runtime',
        runtimeKind: 'tool-result',
        title: 'tool-media',
        subtitle: 'Tool completed',
        status: 'done',
        detail: 'Chart generated.\n[image] image/png, 5 B\n[resource] file:///tmp/report.txt\nReport body',
        details: [
          {
            label: 'Content',
            text: 'Chart generated.\n[image] image/png, 5 B\n[resource] file:///tmp/report.txt\nReport body',
            items: [
              {
                kind: 'text',
                title: 'text',
                text: 'Chart generated.'
              },
              {
                kind: 'media',
                title: 'image',
                meta: 'image/png, 5 B',
                previewUrl: 'data:image/png;base64,aGVsbG8=',
                openTarget: 'data:image/png;base64,aGVsbG8=',
                openTargetKind: 'external'
              },
              {
                kind: 'resource',
                title: 'resource',
                meta: 'file:///tmp/report.txt',
                text: 'Report body',
                openTarget: '/tmp/report.txt',
                openTargetKind: 'path'
              }
            ]
          }
        ],
        resultCards: [
          {
            key: 'content:0',
            kind: 'text',
            title: 'Text',
            text: 'Chart generated.'
          },
          {
            key: 'content:1',
            kind: 'image',
            title: 'Image',
            meta: 'image/png, 5 B',
            previewUrl: 'data:image/png;base64,aGVsbG8=',
            openTarget: 'data:image/png;base64,aGVsbG8=',
            openTargetKind: 'external'
          },
          {
            key: 'content:2',
            kind: 'resource',
            title: 'Resource',
            meta: 'file:///tmp/report.txt',
            text: 'Report body',
            openTarget: '/tmp/report.txt',
            openTargetKind: 'path'
          }
        ]
      }
    ])
  })

  it('keeps remote resource URIs as external open targets', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          {
            type: 'claude-sdk-tool-result',
            source: 'claude-agent-sdk',
            toolCallId: 'tool-link',
            content: [
              {
                type: 'resource',
                resource: {
                  uri: 'https://example.com/report'
                }
              }
            ],
            isError: false
          }
        ],
        text
      )
    ).toEqual([
      {
        key: 'claude-tool-result:tool-link:0',
        kind: 'runtime',
        runtimeKind: 'tool-result',
        title: 'tool-link',
        subtitle: 'Tool completed',
        status: 'done',
        detail: '[resource] https://example.com/report',
        details: [
          {
            label: 'Content',
            text: '[resource] https://example.com/report',
            items: [
              {
                kind: 'resource',
                title: 'resource',
                meta: 'https://example.com/report',
                openTarget: 'https://example.com/report',
                openTargetKind: 'external'
              }
            ]
          }
        ],
        resultCards: [
          {
            key: 'content:0',
            kind: 'resource',
            title: 'Resource',
            meta: 'https://example.com/report',
            openTarget: 'https://example.com/report',
            openTargetKind: 'external'
          }
        ]
      }
    ])
  })

  it('projects meaningful persisted Claude SDK runtime-control parts into compact runtime blocks', () => {
    expect(
      buildAgentRuntimeMessagePartBlocks(
        [
          {
            type: 'claude-sdk-runtime-control',
            source: 'claude-agent-sdk',
            subtype: 'thinking_tokens'
          },
          {
            type: 'claude-sdk-runtime-control',
            source: 'claude-agent-sdk',
            subtype: 'api_retry',
            message: 'Retrying after rate limit'
          },
          {
            type: 'claude-sdk-runtime-control',
            source: 'claude-agent-sdk',
            subtype: 'compact_boundary'
          }
        ],
        text
      )
    ).toEqual([
      {
        key: 'claude-runtime-control:api_retry:1',
        kind: 'runtime',
        runtimeKind: 'control',
        title: 'api_retry',
        subtitle: 'Runtime control event',
        status: 'done',
        detail: 'Retrying after rate limit'
      }
    ])
  })

  it('falls back for unknown non-text message parts', () => {
    expect(buildAgentRuntimeMessagePartBlocks([{ type: 'unknown-custom-part' }], text)).toEqual([
      {
        key: 'fallback:0',
        kind: 'text',
        text: '[Non-text content]'
      }
    ])
  })
})
