import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import AgentRuntimeMessagePartBlocks from './AgentRuntimeMessagePartBlocks'

describe('AgentRuntimeMessagePartBlocks', () => {
  it('groups successful thinking and execution records into compact folded sections', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeMessagePartBlocks
        blocks={[
          {
            key: 'reasoning:1',
            kind: 'runtime',
            runtimeKind: 'reasoning',
            title: 'Processed',
            subtitle: 'Reasoning completed',
            status: 'done',
            detail: 'Plan the program, then run it.'
          },
          {
            key: 'tool-call:write',
            kind: 'runtime',
            runtimeKind: 'tool-call',
            title: 'Write',
            subtitle: 'Tool input ready',
            status: 'running',
            detail: '{ "file_path": "hello.py" }'
          },
          {
            key: 'tool-call:bash',
            kind: 'runtime',
            runtimeKind: 'tool-call',
            title: 'Bash',
            subtitle: 'Tool input ready',
            status: 'running',
            detail: 'python hello.py'
          },
          {
            key: 'tool-result:bash',
            kind: 'runtime',
            runtimeKind: 'tool-result',
            title: 'bash-result',
            subtitle: 'Tool completed',
            status: 'done',
            detail: 'hello world'
          }
        ]}
        text={{
          executionGroupTitle: 'Execution records',
          groupSummary: (count) => `${count} items`,
          open: 'Open',
          reasoningGroupTitle: 'Thinking',
          input: 'Input',
          output: 'Output'
        }}
      />
    )

    expect(markup).toContain('agent-message-runtime-group reasoning')
    expect(markup).toContain('agent-message-runtime-group execution')
    expect(markup).toContain('>Thinking<')
    expect(markup).toContain('>Execution records<')
    expect(markup).toContain('>1 items<')
    expect(markup).toContain('>3 items<')
    expect(markup).not.toContain('class="agent-message-runtime-part reasoning done"')
    expect(markup).not.toContain('class="agent-message-runtime-part tool-call running"')
    expect(markup).not.toContain('class="agent-message-runtime-part tool-result done"')
  })

  it('folds error runtime records into execution groups with collapsed details', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeMessagePartBlocks
        blocks={[
          {
            key: 'tool-result:error',
            kind: 'runtime',
            runtimeKind: 'tool-result',
            title: 'Bash',
            subtitle: 'Tool failed',
            status: 'error',
            detail: 'Command failed'
          }
        ]}
        text={{
          executionGroupTitle: 'Execution records',
          groupSummary: (count) => `${count} items`,
          open: 'Open',
          reasoningGroupTitle: 'Thinking',
          input: 'Input',
          output: 'Output'
        }}
      />
    )

    expect(markup).toContain('agent-message-runtime-group execution')
    expect(markup).toContain('class="agent-message-runtime-group-item tool-result error"')
    expect(markup).toContain('class="agent-message-runtime-detail-fold"')
    expect(markup).not.toContain('class="agent-message-runtime-part tool-result error"')
    expect(markup).not.toContain('class="agent-message-runtime-group-item tool-result error" open=""')
    expect(markup).not.toContain('class="agent-message-runtime-detail-fold" open=""')
  })

  it('renders thumbnails and open actions for previewable detail items', () => {
    const markup = renderToStaticMarkup(
      <AgentRuntimeMessagePartBlocks
        blocks={[
          {
            key: 'runtime:1',
            kind: 'runtime',
            runtimeKind: 'tool-result',
            title: 'tool-media',
            subtitle: 'Tool completed',
            status: 'done',
            detail: null,
            resultCards: [
              {
                key: 'content:0',
                kind: 'image',
                title: 'Image',
                meta: 'image/png, 5 B',
                previewUrl: 'data:image/png;base64,aGVsbG8=',
                openTarget: 'data:image/png;base64,aGVsbG8=',
                openTargetKind: 'external'
              },
              {
                key: 'content:1',
                kind: 'table',
                title: 'Table',
                meta: '1×2',
                table: {
                  columns: ['symbol', 'price'],
                  rows: [['BTC', '65000']]
                }
              }
            ],
            details: [
              {
                label: 'Content',
                text: '[image] image/png, 5 B',
                items: [
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
                    meta: '/tmp/report.txt',
                    openTarget: '/tmp/report.txt',
                    openTargetKind: 'path'
                  }
                ]
              }
            ]
          }
        ]}
        text={{
          executionGroupTitle: 'Execution records',
          groupSummary: (count) => `${count} items`,
          open: 'Open',
          reasoningGroupTitle: 'Thinking',
          input: 'Input',
          output: 'Output'
        }}
      />
    )

    expect(markup).toContain('agent-message-runtime-result-card')
    expect(markup).toContain('agent-message-runtime-result-table')
    expect(markup).toContain('agent-message-runtime-preview')
    expect(markup).toContain('data:image/png;base64,aGVsbG8=')
    expect(markup).toContain('>Open<')
  })

  it('renders a host context card and falls back to the neutral card for unknown kinds', () => {
    const part = {
      type: 'agent-context' as const,
      kind: 'market-analysis-node',
      label: '10-23 16:25 分析结论',
      detail: '10月制造业 PMI（初值）'
    }
    const text = {
      executionGroupTitle: 'Execution records',
      groupSummary: (count: number) => `${count} items`,
      open: 'Open',
      reasoningGroupTitle: 'Thinking',
      input: 'Input',
      output: 'Output'
    }

    const fallback = renderToStaticMarkup(
      <AgentRuntimeMessagePartBlocks blocks={[{ key: 'context:0', kind: 'context', part }]} text={text} />
    )
    expect(fallback).toContain('agent-message-context-card')
    expect(fallback).toContain('10-23 16:25 分析结论')

    const hosted = renderToStaticMarkup(
      <AgentRuntimeMessagePartBlocks
        blocks={[{ key: 'context:0', kind: 'context', part }]}
        contextRenderers={{
          'market-analysis-node': ({ part: value }) => <strong data-product-context>{value.label}</strong>
        }}
        text={text}
      />
    )
    expect(hosted).toContain('data-product-context')
    expect(hosted).not.toContain('agent-message-context-card')
  })
})
