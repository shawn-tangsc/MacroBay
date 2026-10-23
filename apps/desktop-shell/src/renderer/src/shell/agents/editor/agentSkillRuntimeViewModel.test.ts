import { describe, expect, it } from 'vitest'

import { buildAgentSkillRuntimeViewModel } from './agentSkillRuntimeViewModel'

describe('buildAgentSkillRuntimeViewModel', () => {
  it('surfaces runtime tool/capability counts plus the richest available summary', () => {
    expect(
      buildAgentSkillRuntimeViewModel({
        skillId: 'skill-1',
        name: 'Code Reader',
        description: 'Reads code safely.',
        folderName: 'code-reader',
        source: 'local',
        tools: ['Read Docs', 'Grep'],
        runtimeTools: [
          { toolName: 'Read Docs', toolId: 'skill__code-reader__read-docs' },
          { toolName: 'Grep', toolId: 'skill__code-reader__grep' }
        ],
        capabilities: [
          {
            capabilityId: 'skill-1:SKILL.md',
            kind: 'entry-file-summary',
            title: 'Code Reader instructions',
            summary: 'Inspect repository layout first.',
            bodyPreview: 'Read the workspace before editing.',
            bodyPreviewTruncated: true
          }
        ]
      })
    ).toEqual({
      toolCount: 2,
      capabilityCount: 1,
      runtimeTools: [
        { toolName: 'Read Docs', toolId: 'skill__code-reader__read-docs' },
        { toolName: 'Grep', toolId: 'skill__code-reader__grep' }
      ],
      capabilities: [
        {
          capabilityId: 'skill-1:SKILL.md',
          kind: 'entry-file-summary',
          title: 'Code Reader instructions',
          summary: 'Inspect repository layout first.',
          bodyPreview: 'Read the workspace before editing.',
          bodyPreviewTruncated: true
        }
      ],
      primarySummary: 'Inspect repository layout first.',
      statusKind: 'ready'
    })
  })

  it('falls back to a neutral empty runtime state when no runtime entry exists yet', () => {
    expect(buildAgentSkillRuntimeViewModel(null)).toEqual({
      toolCount: 0,
      capabilityCount: 0,
      runtimeTools: [],
      capabilities: [],
      primarySummary: null,
      statusKind: 'unavailable'
    })
  })

  it('marks installed skills without runtime tools/capabilities as empty', () => {
    expect(
      buildAgentSkillRuntimeViewModel({
        skillId: 'skill-empty',
        name: 'Empty Skill',
        description: 'No runtime yet.',
        folderName: 'empty-skill',
        source: 'local',
        tools: [],
        runtimeTools: [],
        capabilities: []
      })
    ).toMatchObject({
      statusKind: 'empty',
      primarySummary: null
    })
  })
})
