import type { AgentStoreSeed } from '../store/agentStore'
import type { SafeModelProvider } from '../../providers/modelProviderTypes'
import type { AppLanguage } from '../../../settings/schema/appSettings'

/** 产品种子按当前界面语言生成内置文案，避免把中文名字写进英文界面。 */
export type ProductAgentSeedOptions = {
  language?: AppLanguage
}

export type ProductAgentSeedFactory = Readonly<{
  productId: string
  create: (providers?: SafeModelProvider[], options?: ProductAgentSeedOptions) => AgentStoreSeed
}>

export function mergeAgentSeeds(...seeds: readonly AgentStoreSeed[]): AgentStoreSeed {
  const arrays = <T>(key: keyof AgentStoreSeed): T[] => seeds.flatMap((seed) => (seed[key] as T[] | undefined) ?? [])
  const messagesBySessionId = Object.fromEntries(
    seeds.flatMap((seed) => Object.entries(seed.messagesBySessionId ?? {}))
  )

  return {
    agents: arrays('agents'),
    sessions: arrays('sessions'),
    workspaces: arrays('workspaces'),
    sessionPins: arrays('sessionPins'),
    messagesBySessionId,
    mcpServers: arrays('mcpServers'),
    mcpToolsByServerId: Object.assign({}, ...seeds.map((seed) => seed.mcpToolsByServerId ?? {})),
    mcpRuntimeStatusByServerId: Object.assign({}, ...seeds.map((seed) => seed.mcpRuntimeStatusByServerId ?? {})),
    channels: arrays('channels'),
    skills: arrays('skills'),
    agentSkills: arrays('agentSkills'),
    agentProductToolPackages: arrays('agentProductToolPackages'),
    tasks: arrays('tasks'),
    taskRunLogs: arrays('taskRunLogs'),
    channelTaskSubscriptions: arrays('channelTaskSubscriptions'),
    activeAgentId: seeds.find((seed) => seed.activeAgentId)?.activeAgentId,
    activeSessionId: seeds.find((seed) => seed.activeSessionId)?.activeSessionId
  }
}
