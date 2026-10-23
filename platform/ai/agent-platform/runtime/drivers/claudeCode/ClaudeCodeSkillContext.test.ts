import { describe, expect, it } from 'vitest'

import { buildClaudeCodeSkillContext } from './ClaudeCodeSkillContext'

describe('Claude Code skill context', () => {
  it('includes platform-owned skill capability hints when present', () => {
    const context = buildClaudeCodeSkillContext([
      {
        skillId: 'skill-1',
        name: 'Code Reader',
        description: 'Reads and analyzes code',
        author: 'OpenAI',
        namespace: null,
        folderName: 'code-reader',
        source: 'local',
        tags: ['code'],
        tools: ['Read'],
        capabilities: [
          {
            capabilityId: 'skill-1:SKILL.md',
            kind: 'entry-file-summary',
            title: 'Code Reader instructions',
            summary: 'Use this skill when inspecting unfamiliar repositories.',
            sourcePath: 'SKILL.md',
            entryFile: 'SKILL.md',
            bodyPreview: 'Read package boundaries before changing files.',
            bodyPreviewTruncated: false
          },
          {
            capabilityId: 'skill-1:references/usage.md',
            kind: 'supporting-file-summary',
            title: 'Usage Guide',
            summary: 'Extra runtime guidance.',
            sourcePath: 'references/usage.md',
            bodyPreview: 'Only read files inside the current workspace.',
            bodyPreviewTruncated: false
          }
        ]
      }
    ])

    expect(context).toBe(
      [
        'Enabled skills:',
        '',
        '- Code Reader: Reads and analyzes code. Declared tools: Read. Tags: code. Author: OpenAI. Source: local. Capabilities: Code Reader instructions - Use this skill when inspecting unfamiliar repositories. File: SKILL.md. Notes: Read package boundaries before changing files; Usage Guide - Extra runtime guidance. File: references/usage.md. Notes: Only read files inside the current workspace.'
      ].join('\n')
    )
  })
})
