import { describe, expect, it } from 'vitest'

import { buildAgentMessageText, type AgentAttachedFile } from './agentMessageInput'

describe('agent message input', () => {
  it('builds a plain message when there are no files', () => {
    expect(buildAgentMessageText('  hello  ', [])).toBe('hello')
  })

  it('includes text attachment content and truncation notice', () => {
    const files: AgentAttachedFile[] = [
      {
        path: '/tmp/notes.md',
        name: 'notes.md',
        text: 'line one\nline two',
        truncated: true
      }
    ]

    expect(buildAgentMessageText('Review this', files)).toContain('Review this')
    expect(buildAgentMessageText('Review this', files)).toContain('File: notes.md')
    expect(buildAgentMessageText('Review this', files)).toContain('line one\nline two')
    expect(buildAgentMessageText('Review this', files)).toContain('truncated')
  })

  it('includes attachment read errors instead of silently dropping files', () => {
    const files: AgentAttachedFile[] = [
      {
        path: '/tmp/archive.zip',
        name: 'archive.zip',
        error: 'Binary files are not supported'
      }
    ]

    expect(buildAgentMessageText('', files)).toContain('archive.zip')
    expect(buildAgentMessageText('', files)).toContain('Binary files are not supported')
  })

  it('keeps non-text attachments as path-only references', () => {
    const files: AgentAttachedFile[] = [
      {
        path: '/tmp/chart.png',
        name: 'chart.png',
        kind: 'image'
      }
    ]

    expect(buildAgentMessageText('Review this image', files)).toContain('Review this image')
    expect(buildAgentMessageText('Review this image', files)).toContain('File: chart.png')
    expect(buildAgentMessageText('Review this image', files)).toContain('Path: /tmp/chart.png')
    expect(buildAgentMessageText('Review this image', files)).toContain('image attachment')
  })
})
