import type { SkillService } from '../../ai/agent-platform/skills/skillService'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { AgentPersistentWriteOptions } from '../../ai/agent-platform/store/agentPersistentStore'

type AgentStateCoordinatorDependencies = {
  getState: () => Promise<AgentStoreState>
  replaceState: (state: AgentStoreState, options?: AgentPersistentWriteOptions) => Promise<AgentStoreState>
  enableBuiltinSkillsForNewAgents: SkillService['enableBuiltinSkillsForNewAgents']
  reconcileWorkspaceSkills: SkillService['reconcileWorkspaceSkills']
  syncSkillsRuntimeFromState: (state: AgentStoreState) => void
  syncProductToolsRuntimeFromState?: (state: AgentStoreState) => void
  syncMcpRuntimeFromState: (state: AgentStoreState) => void
  syncChannelsFromState: (state: AgentStoreState) => Promise<unknown> | void
  syncTaskSchedulerFromState: (state: AgentStoreState) => void
  emitStateChanged: (state: AgentStoreState) => void
}

export type ReplaceAgentStateOptions = {
  previousState?: AgentStoreState
  persist?: AgentPersistentWriteOptions
  beforePersist?: (previousState: AgentStoreState, nextState: AgentStoreState) => Promise<void> | void
}

export function createAgentStateCoordinator(deps: AgentStateCoordinatorDependencies) {
  async function replaceState(
    state: AgentStoreState,
    options: ReplaceAgentStateOptions = {}
  ): Promise<AgentStoreState> {
    const previousState = options.previousState ?? (await deps.getState())
    const withBuiltinDefaults = await deps.enableBuiltinSkillsForNewAgents(state)
    const workspacePaths = collectSessionWorkspacePaths(previousState, withBuiltinDefaults)

    for (const workspacePath of workspacePaths) {
      await deps.reconcileWorkspaceSkills(withBuiltinDefaults, workspacePath)
    }

    await options.beforePersist?.(previousState, withBuiltinDefaults)
    const nextState = await deps.replaceState(withBuiltinDefaults, options.persist)
    deps.syncSkillsRuntimeFromState(nextState)
    deps.syncProductToolsRuntimeFromState?.(nextState)
    deps.syncMcpRuntimeFromState(nextState)
    void deps.syncChannelsFromState(nextState)
    deps.syncTaskSchedulerFromState(nextState)
    deps.emitStateChanged(nextState)
    return nextState
  }

  async function syncAfterMutation(previousState: AgentStoreState): Promise<AgentStoreState> {
    return replaceState(await deps.getState(), { previousState })
  }

  return {
    replaceState,
    syncAfterMutation
  }
}

function collectSessionWorkspacePaths(...states: AgentStoreState[]): string[] {
  const paths = new Set<string>()
  for (const state of states) {
    for (const session of state.sessions) {
      const workspacePath = session.workspace.path
      if (workspacePath) paths.add(workspacePath)
    }
  }
  return [...paths]
}
