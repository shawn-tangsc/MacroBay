import { describe, expect, it } from 'vitest'

import type { AgentSkillsRuntimeSnapshot } from './skillRuntimeSchemas'
import { buildAgentSkillsRuntimeCatalog } from './skillRuntimeInspector'

describe('buildAgentSkillsRuntimeCatalog', () => {
  it('projects per-skill runtime tool ids and capability hints into an inspectable catalog', () => {
    const snapshot: AgentSkillsRuntimeSnapshot = {
      agentId: 'agent-1',
      skills: [
        {
          skillId: 'skill-1',
          name: 'Code Reader',
          description: 'Reads code safely.',
          folderName: 'code-reader',
          source: 'local',
          tools: ['Read Docs', 'Read Docs', 'Grep'],
          capabilities: [
            {
              capabilityId: 'skill-1:SKILL.md',
              kind: 'entry-file-summary',
              title: 'Code Reader instructions',
              summary: 'Inspect repository layout first.',
              sourcePath: 'SKILL.md',
              entryFile: 'SKILL.md',
              bodyPreview: 'Read the workspace before editing.',
              bodyPreviewTruncated: false
            }
          ]
        }
      ],
      toolIds: ['skill__code-reader__read-docs', 'skill__code-reader__grep']
    }

    expect(buildAgentSkillsRuntimeCatalog(snapshot)).toEqual({
      agentId: 'agent-1',
      skills: [
        {
          skillId: 'skill-1',
          name: 'Code Reader',
          description: 'Reads code safely.',
          folderName: 'code-reader',
          source: 'local',
          tools: ['Read Docs', 'Read Docs', 'Grep'],
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
              sourcePath: 'SKILL.md',
              entryFile: 'SKILL.md',
              bodyPreview: 'Read the workspace before editing.',
              bodyPreviewTruncated: false
            }
          ]
        }
      ]
    })
  })

  it('returns an empty catalog when the agent has no enabled runtime skills', () => {
    expect(
      buildAgentSkillsRuntimeCatalog({
        agentId: 'agent-1',
        skills: [],
        toolIds: []
      })
    ).toEqual({
      agentId: 'agent-1',
      skills: []
    })
  })
})
