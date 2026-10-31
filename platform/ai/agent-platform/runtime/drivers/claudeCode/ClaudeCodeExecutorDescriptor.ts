import type { ClaudeCodeProviderEnvironmentMetadata } from './ClaudeCodeProviderEnvironment'
import type { ClaudeCodeQueryOptions, ClaudeCodeRuntimeMetadata, ClaudeCodeSdkQueryOptions } from './ClaudeCodeQueryOptions'
import type { ClaudeCodeToolHooks } from './ClaudeCodeToolHooks'
import type { ClaudeCodeToolPolicy } from './ClaudeCodeToolPolicy'
import { cloneAgentSkillRuntimeEntry } from '../../../skills/skillRuntimeSchemas'

export type ClaudeCodeExecutorDescriptor = {
  sdkOptions: ClaudeCodeSdkQueryOptions
  metadata: ClaudeCodeRuntimeMetadata & {
    providerMetadata?: ClaudeCodeProviderEnvironmentMetadata
    toolPolicy: ClaudeCodeToolPolicy
  }
  toolHooks: ClaudeCodeToolHooks
  signal: AbortSignal
}

export type CreateClaudeCodeExecutorDescriptorInput = {
  query: ClaudeCodeQueryOptions
  toolHooks: ClaudeCodeToolHooks
  signal: AbortSignal
  providerMetadata?: ClaudeCodeProviderEnvironmentMetadata
}

export function createClaudeCodeExecutorDescriptor(
  input: CreateClaudeCodeExecutorDescriptorInput
): ClaudeCodeExecutorDescriptor {
  return {
    sdkOptions: cloneSdkOptions(input.query.sdkOptions),
    metadata: {
      ...cloneRuntimeMetadata(input.query.runtimeMetadata),
      ...(input.providerMetadata ? { providerMetadata: { ...input.providerMetadata } } : {})
    },
    toolHooks: input.toolHooks,
    signal: input.signal
  }
}

function cloneSdkOptions(options: ClaudeCodeSdkQueryOptions): ClaudeCodeSdkQueryOptions {
  return {
    ...options,
    env: { ...options.env },
    allowedTools: [...options.allowedTools],
    disallowedTools: [...options.disallowedTools],
    ...(options.outputFormat ? { outputFormat: { ...options.outputFormat, schema: { ...options.outputFormat.schema } } } : {})
  }
}

function cloneRuntimeMetadata(metadata: ClaudeCodeRuntimeMetadata): ClaudeCodeRuntimeMetadata {
  return {
    mcpSources: metadata.mcpSources.map((source) => ({ ...source })),
    mcpServers: metadata.mcpServers.map((server) => {
      if (server.transport === 'stdio') {
        return {
          ...server,
          args: [...server.args],
          ...(server.env ? { env: { ...server.env } } : {})
        }
      }

      return {
        ...server,
        ...(server.headers ? { headers: { ...server.headers } } : {})
      }
    }),
    skills: metadata.skills.map((skill) => ({
      ...cloneAgentSkillRuntimeEntry(skill)
    })),
    skillToolIds: [...metadata.skillToolIds],
    ...(metadata.runtimeMcpToolNames ? { runtimeMcpToolNames: [...metadata.runtimeMcpToolNames] } : {}),
    ...(metadata.skillContext !== undefined ? { skillContext: metadata.skillContext } : {}),
    ...(metadata.outputLimit ? { outputLimit: { ...metadata.outputLimit } } : {}),
    toolPolicy: cloneToolPolicy(metadata.toolPolicy)
  }
}

function cloneToolPolicy(policy: ClaudeCodeToolPolicy): ClaudeCodeToolPolicy {
  return {
    ...policy,
    allowedTools: [...policy.allowedTools],
    disallowedTools: [...policy.disallowedTools],
    mcpSources: policy.mcpSources.map((source) => ({ ...source })),
    skillToolIds: [...policy.skillToolIds],
    ...(policy.runtimeMcpToolNames ? { runtimeMcpToolNames: [...policy.runtimeMcpToolNames] } : {}),
    ...(policy.runtimeMcpApprovalByName ? { runtimeMcpApprovalByName: { ...policy.runtimeMcpApprovalByName } } : {})
  }
}
