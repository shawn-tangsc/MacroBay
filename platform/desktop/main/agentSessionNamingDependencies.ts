import { requestOpenAiCompatibleChatCompletion } from '../../ai/invocation/openAiChatCompletionClient'
import { resolveChatModel } from '../../ai/invocation/resolveChatModel'
import {
  AgentSessionNamingService,
  type AgentSessionNamingGenerateTitleInput,
  type AgentSessionNamingResult
} from '../../ai/agent-platform/runtime/naming'
import { updateAgentSession } from '../../ai/agent-platform/store/agentStore'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { ProviderState } from '../../ai/providers/modelProviderTypes'
import type { AppSettings } from '../../settings/schema/appSettings'

export type AgentSessionNamingControl = {
  maybeRenameAfterTurn: (input: {
    agentId: string
    sessionId: string
    sessionName: string
    userText: string
    assistantText: string
    modelId: string | null
  }) => Promise<AgentSessionNamingResult>
}

export type AgentSessionNamingDependencyFactoryOptions = {
  getSettings: () => Promise<AppSettings>
  getProviderState: () => Promise<ProviderState>
  getAgentState: () => Promise<AgentStoreState>
  saveAgentState: (state: AgentStoreState) => Promise<void>
  fetch?: typeof fetch
}

export function createAgentSessionNamingControl(
  options: AgentSessionNamingDependencyFactoryOptions
): AgentSessionNamingControl {
  const service = new AgentSessionNamingService({
    isEnabled: async () => (await options.getSettings()).agent.sessionNamingEnabled,
    getLanguage: async () => (await options.getSettings()).language,
    getNamingPrompt: async () => {
      const prompt = (await options.getSettings()).agent.sessionNamingPrompt.trim()
      return prompt || null
    },
    generateTitle: (input) => generateSessionTitle(options, input),
    renameSession: async (sessionId, name) => {
      const state = await options.getAgentState()
      const next = updateAgentSession(state, sessionId, { name })
      if (next === state) return
      await options.saveAgentState(next)
    }
  })

  return {
    maybeRenameAfterTurn: (input) => service.maybeRenameAfterTurn(input)
  }
}

export function resolveAgentSessionNamingModelId(input: {
  settings: AppSettings
  providerState: ProviderState
  agentModelId: string | null
}): string | null {
  const configured = input.settings.agent.sessionNamingModelId.trim()
  const candidates = [configured, input.agentModelId?.trim() ?? ''].filter(Boolean)
  for (const candidate of candidates) {
    const parsed = parseUniqueModelId(candidate)
    if (!parsed) continue
    const resolved = resolveChatModel(input.providerState, parsed.providerId, parsed.modelId)
    if (resolved.ok) return `${resolved.model.providerId}:${resolved.model.modelId}`
  }
  return null
}

async function generateSessionTitle(
  options: AgentSessionNamingDependencyFactoryOptions,
  input: AgentSessionNamingGenerateTitleInput
): Promise<string | null> {
  const providerState = await options.getProviderState()
  const parsed = parseUniqueModelId(input.modelId)
  if (!parsed) return null
  const resolved = resolveChatModel(providerState, parsed.providerId, parsed.modelId)
  if (!resolved.ok) return null

  const completion = await requestOpenAiCompatibleChatCompletion({
    baseUrl: resolved.model.baseUrl,
    apiKey: resolved.model.apiKey,
    modelId: resolved.model.modelId,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.conversation }
    ],
    temperature: 0.2,
    jsonMode: false,
    fetch: options.fetch
  })

  if (!completion.ok) return null
  return completion.content
}

function parseUniqueModelId(value: string): { providerId: string; modelId: string } | null {
  const separatorIndex = value.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) return null
  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1)
  }
}
