import { AgentChannelService } from './AgentChannelService'
import { AgentService } from './AgentService'
import { AgentSessionMessageService } from './AgentSessionMessageService'
import { AgentSessionService } from './AgentSessionService'
import { AgentTaskService } from './AgentTaskService'
import { AgentTaskAutomationQueryService } from './AgentTaskAutomationQueryService'
import { AgentWorkspaceService } from './AgentWorkspaceService'
import type { AgentPlatformQueryAdapters, AgentPlatformStateStore } from './agentServiceTypes'
import { TaskAutomationCommandService } from '../runtime/tasks/TaskAutomationCommandService'
import type { TaskAutomationPolicyPreset } from '../runtime/tasks/taskAutomationContracts'

export type { AgentPlatformStateStore } from './agentServiceTypes'

export type AgentPlatformServices = ReturnType<typeof createAgentPlatformServices>

export function createAgentPlatformServices(
  store: AgentPlatformStateStore,
  options: {
    queries?: AgentPlatformQueryAdapters
    taskAutomation?: {
      getPolicyPreset?: () => Promise<TaskAutomationPolicyPreset>
      setPolicyPreset?: (preset: TaskAutomationPolicyPreset) => Promise<void>
      defaultTimezone?: string
      now?: () => Date
      hasEnabledDeliveryTarget?: (channelId: string, agentId: string) => boolean
    }
  } = {}
) {
  const taskCommands = new TaskAutomationCommandService({
    store,
    getPolicyPreset: options.taskAutomation?.getPolicyPreset ?? (async () => 'balanced'),
    defaultTimezone: options.taskAutomation?.defaultTimezone,
    now: options.taskAutomation?.now,
    hasEnabledDeliveryTarget: options.taskAutomation?.hasEnabledDeliveryTarget
  })
  return {
    state: store,
    taskCommands,
    agents: new AgentService(store, options.queries),
    sessions: new AgentSessionService(store, options.queries),
    messages: new AgentSessionMessageService(store, options.queries),
    workspaces: new AgentWorkspaceService(store, options.queries),
    channels: new AgentChannelService(store, taskCommands, options.queries),
    tasks: new AgentTaskService(store, taskCommands, options.queries),
    taskAutomation: new AgentTaskAutomationQueryService({
      queries: options.queries ?? {},
      getPolicyPreset: options.taskAutomation?.getPolicyPreset ?? (async () => 'balanced'),
      setPolicyPreset: options.taskAutomation?.setPolicyPreset ?? (async () => undefined),
      defaultTimezone: options.taskAutomation?.defaultTimezone,
      now: options.taskAutomation?.now
    })
  }
}
