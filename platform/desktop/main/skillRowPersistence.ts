import type { InstalledSkill } from '../../ai/agent-platform/schemas/skillSchemas'
import type { AgentSkillBinding, AgentStoreState } from '../../ai/agent-platform/store/agentStore'

export type SkillRowPersistenceRepositories = {
  skills: {
    upsert: (skill: InstalledSkill) => void
    delete: (skillId: string) => void
  }
  agentSkills: {
    replaceForAgent: (agentId: string, bindings: readonly AgentSkillBinding[]) => void
  }
}

export function persistSkillRowChanges(input: {
  previousState: AgentStoreState
  nextState: AgentStoreState
  repositories: SkillRowPersistenceRepositories
}): void {
  const previousSkillsById = new Map(input.previousState.skills.map((skill) => [skill.id, skill]))
  const nextSkillsById = new Map(input.nextState.skills.map((skill) => [skill.id, skill]))

  for (const skill of input.nextState.skills) {
    if (!areSkillsEqual(previousSkillsById.get(skill.id), skill)) {
      input.repositories.skills.upsert(skill)
    }
  }

  for (const skill of input.previousState.skills) {
    if (!nextSkillsById.has(skill.id)) {
      input.repositories.skills.delete(skill.id)
    }
  }

  const affectedAgentIds = collectAffectedAgentIds(input.previousState.agentSkills, input.nextState.agentSkills)
  for (const agentId of affectedAgentIds) {
    input.repositories.agentSkills.replaceForAgent(
      agentId,
      input.nextState.agentSkills.filter((binding) => binding.agentId === agentId)
    )
  }
}

function collectAffectedAgentIds(
  previousBindings: readonly AgentSkillBinding[],
  nextBindings: readonly AgentSkillBinding[]
): string[] {
  const previousByKey = new Map(previousBindings.map((binding) => [skillBindingKey(binding), binding]))
  const nextByKey = new Map(nextBindings.map((binding) => [skillBindingKey(binding), binding]))
  const affected = new Set<string>()

  for (const binding of nextBindings) {
    if (!areSkillBindingsEqual(previousByKey.get(skillBindingKey(binding)), binding)) {
      affected.add(binding.agentId)
    }
  }
  for (const binding of previousBindings) {
    if (!nextByKey.has(skillBindingKey(binding))) {
      affected.add(binding.agentId)
    }
  }

  return [...affected].sort()
}

function skillBindingKey(binding: AgentSkillBinding): string {
  return `${binding.agentId}:${binding.skillId}`
}

function areSkillBindingsEqual(left: AgentSkillBinding | undefined, right: AgentSkillBinding): boolean {
  return left?.agentId === right.agentId && left.skillId === right.skillId && left.isEnabled === right.isEnabled
}

function areSkillsEqual(left: InstalledSkill | undefined, right: InstalledSkill): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right)
}
