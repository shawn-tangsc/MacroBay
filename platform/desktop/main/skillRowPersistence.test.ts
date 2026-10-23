import { describe, expect, it } from 'vitest'

import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'
import { createAgentStoreState, type AgentSkillBinding } from '../../ai/agent-platform/store/agentStore'
import { persistSkillRowChanges, type SkillRowPersistenceRepositories } from './skillRowPersistence'

const createdAt = '2026-01-01T00:00:00.000Z'

const skill: InstalledSkill = {
  id: 'skill-1',
  name: 'Code Review',
  description: 'Review code',
  folderName: 'code-review',
  source: 'local',
  sourceUrl: null,
  namespace: null,
  author: null,
  sourceTags: ['code'],
  contentHash: 'hash-1',
  isEnabled: true,
  createdAt,
  updatedAt: createdAt
}

function createSpyRepositories(): {
  calls: {
    upserts: InstalledSkill[]
    deletes: string[]
    replacements: Array<{ agentId: string; bindings: AgentSkillBinding[] }>
  }
  repositories: SkillRowPersistenceRepositories
} {
  const calls = {
    upserts: [] as InstalledSkill[],
    deletes: [] as string[],
    replacements: [] as Array<{ agentId: string; bindings: AgentSkillBinding[] }>
  }
  return {
    calls,
    repositories: {
      skills: {
        upsert: (nextSkill) => calls.upserts.push(nextSkill),
        delete: (skillId) => calls.deletes.push(skillId)
      },
      agentSkills: {
        replaceForAgent: (agentId, bindings) =>
          calls.replacements.push({
            agentId,
            bindings: [...bindings]
          })
      }
    }
  }
}

describe('skill row persistence', () => {
  it('persists focused skill row changes and replaces only affected agent binding sets', () => {
    const previousState = createAgentStoreState({
      skills: [skill],
      agentSkills: [
        { agentId: 'agent-1', skillId: 'skill-1', isEnabled: true },
        { agentId: 'agent-2', skillId: 'skill-1', isEnabled: true }
      ]
    })
    const updatedSkill: InstalledSkill = {
      ...skill,
      name: 'Code Review Updated',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
    const addedSkill: InstalledSkill = {
      ...skill,
      id: 'skill-2',
      name: 'Docs Writer',
      folderName: 'docs-writer',
      contentHash: 'hash-2'
    }
    const nextState = createAgentStoreState({
      skills: [updatedSkill, addedSkill],
      agentSkills: [
        { agentId: 'agent-1', skillId: 'skill-2', isEnabled: false },
        { agentId: 'agent-2', skillId: 'skill-1', isEnabled: true }
      ]
    })
    const { calls, repositories } = createSpyRepositories()

    persistSkillRowChanges({ previousState, nextState, repositories })

    expect(calls.upserts.map((item) => item.id)).toEqual(['skill-1', 'skill-2'])
    expect(calls.deletes).toEqual([])
    expect(calls.replacements).toEqual([
      {
        agentId: 'agent-1',
        bindings: [{ agentId: 'agent-1', skillId: 'skill-2', isEnabled: false }]
      }
    ])
  })

  it('deletes removed skills and clears affected agents when their bindings disappear', () => {
    const previousState = createAgentStoreState({
      skills: [skill],
      agentSkills: [{ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }]
    })
    const nextState = createAgentStoreState()
    const { calls, repositories } = createSpyRepositories()

    persistSkillRowChanges({ previousState, nextState, repositories })

    expect(calls.upserts).toEqual([])
    expect(calls.deletes).toEqual(['skill-1'])
    expect(calls.replacements).toEqual([{ agentId: 'agent-1', bindings: [] }])
  })
})
