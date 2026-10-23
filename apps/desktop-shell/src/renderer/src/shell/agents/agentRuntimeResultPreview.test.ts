import { describe, expect, it } from 'vitest'

import { buildAgentRuntimeResultPreviewCards } from './agentRuntimeResultPreview'

const labels = {
  text: 'Text',
  json: 'JSON',
  image: 'Image',
  resource: 'Resource',
  table: 'Table',
  error: 'Error'
}

describe('buildAgentRuntimeResultPreviewCards', () => {
  it('builds an error card from tool failure payloads', () => {
    expect(
      buildAgentRuntimeResultPreviewCards({
        isError: true,
        errorText: 'Permission denied',
        labels,
        fallback: '[Non-text content]'
      })
    ).toEqual([
      {
        key: 'error:0',
        kind: 'error',
        title: 'Error',
        text: 'Permission denied'
      }
    ])
  })

  it('classifies content blocks into text, image, and resource cards', () => {
    expect(
      buildAgentRuntimeResultPreviewCards({
        content: [
          { type: 'text', text: 'Chart generated.' },
          { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
          { type: 'resource', resource: { uri: 'file:///tmp/report.txt', text: 'Report body' } }
        ],
        labels,
        fallback: '[Non-text content]'
      })
    ).toEqual([
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
    ])
  })

  it('detects table-like structured content', () => {
    expect(
      buildAgentRuntimeResultPreviewCards({
        structuredContent: [
          { symbol: 'BTC', price: 65000 },
          { symbol: 'ETH', price: 3500 }
        ],
        labels,
        fallback: '[Non-text content]'
      })
    ).toEqual([
      {
        key: 'structured:table',
        kind: 'table',
        title: 'Table',
        meta: '2×2',
        table: {
          columns: ['symbol', 'price'],
          rows: [
            ['BTC', '65000'],
            ['ETH', '3500']
          ]
        }
      }
    ])
  })

  it('falls back to json or text cards for plain outputs', () => {
    expect(
      buildAgentRuntimeResultPreviewCards({
        output: { ok: true, count: 2 },
        labels,
        fallback: '[Non-text content]'
      })
    ).toEqual([
      {
        key: 'output:json',
        kind: 'json',
        title: 'JSON',
        text: '{\n  "ok": true,\n  "count": 2\n}'
      }
    ])

    expect(
      buildAgentRuntimeResultPreviewCards({
        output: 'Human readable result',
        labels,
        fallback: '[Non-text content]'
      })
    ).toEqual([
      {
        key: 'output:text',
        kind: 'text',
        title: 'Text',
        text: 'Human readable result'
      }
    ])
  })
})
