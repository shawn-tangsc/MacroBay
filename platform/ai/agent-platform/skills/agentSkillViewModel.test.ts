import { describe, expect, it } from 'vitest'

import type { InstalledSkill } from '../schemas/skillSchemas'
import { buildAgentSkillCatalog } from './agentSkillViewModel'

const skill: InstalledSkill = {
  id: 'skill-1',
  name: 'Code Reader',
  description: 'Reads source context',
  folderName: 'code-reader',
  source: 'builtin',
  sourceUrl: null,
  namespace: null,
  author: null,
  sourceTags: ['code'],
  contentHash: 'hash-1',
  isEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('agent skill view model', () => {
  it('joins global skills with per-agent enabled state', () => {
    const catalog = buildAgentSkillCatalog([skill], [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }], 'agent-1')

    expect(catalog).toEqual([expect.objectContaining({ id: 'skill-1', enabledForAgent: true })])
  })

  it('filters disabled global skills and searches across skill metadata', () => {
    const catalog = buildAgentSkillCatalog(
      [
        skill,
        {
          ...skill,
          id: 'skill-2',
          name: 'Hidden',
          folderName: 'hidden',
          isEnabled: false
        }
      ],
      [],
      'agent-1',
      'source context'
    )

    expect(catalog.map((item) => item.id)).toEqual(['skill-1'])
    expect(catalog[0].enabledForAgent).toBe(false)
  })
})
