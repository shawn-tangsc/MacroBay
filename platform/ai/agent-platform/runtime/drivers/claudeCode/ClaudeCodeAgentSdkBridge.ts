import type { ClaudeCodeExecutorDescriptor } from './ClaudeCodeExecutorDescriptor'
import type { ClaudeCodeMcpServerConfig } from './ClaudeCodeMcpServerConfig'

export type ClaudeCodeAgentSdkMcpServer =
  | {
      type: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
    }
  | {
      type: 'http'
      url: string
      headers?: Record<string, string>
    }

export type ClaudeCodeAgentSdkCanUseToolContext = {
  signal?: AbortSignal
  toolUseID?: string
  requestId?: string
}

export type ClaudeCodeAgentSdkCanUseToolResult =
  | {
      behavior: 'allow'
      updatedInput?: unknown
      toolUseID?: string
    }
  | {
      behavior: 'deny'
      message: string
      toolUseID?: string
    }

export type ClaudeCodeAgentSdkHookEvent = {
  hook_event_name: 'PreToolUse'
  session_id: string
  transcript_path: string
  cwd: string
  tool_name: string
  tool_input?: unknown
  tool_use_id: string
}

export type ClaudeCodeAgentSdkHookResult =
  | {
      continue: true
      decision: 'approve'
      hookSpecificOutput: {
        hookEventName: 'PreToolUse'
        permissionDecision: 'allow'
        updatedInput?: unknown
      }
    }
  | {
      continue: false
      decision: 'block'
      reason: string
      hookSpecificOutput: {
        hookEventName: 'PreToolUse'
        permissionDecision: 'deny'
        permissionDecisionReason: string
      }
    }

export type ClaudeCodeAgentSdkHookHandler = (
  event: ClaudeCodeAgentSdkHookEvent,
  toolUseId: string,
  context: { signal?: AbortSignal }
) => Promise<ClaudeCodeAgentSdkHookResult>

export type ClaudeCodeAgentSdkOptions = {
  model: string
  cwd: string
  env: Record<string, string>
  permissionMode: ClaudeCodeExecutorDescriptor['sdkOptions']['permissionMode']
  thinking?: { type: 'disabled' }
  effort?: 'low' | 'high' | 'max'
  allowedTools: string[]
  disallowedTools: string[]
  abortController?: AbortController
  resume?: string
  outputFormat?: ClaudeCodeExecutorDescriptor['sdkOptions']['outputFormat']
  stderr?: ClaudeCodeExecutorDescriptor['sdkOptions']['stderr']
  strictMcpConfig: true
  allowDangerouslySkipPermissions?: boolean
  mcpServers?: Record<string, unknown>
  canUseTool?: (
    toolName: string,
    input: unknown,
    context: ClaudeCodeAgentSdkCanUseToolContext
  ) => Promise<ClaudeCodeAgentSdkCanUseToolResult>
  hooks?: {
    PreToolUse: Array<{
      matcher: '*'
      hooks: ClaudeCodeAgentSdkHookHandler[]
    }>
  }
}

export type ClaudeCodeAgentSdkQueryRequest = {
  prompt: string
  options: ClaudeCodeAgentSdkOptions
}

export type ClaudeCodeAgentSdkStartupRequest = {
  options: ClaudeCodeAgentSdkOptions
}

export function createClaudeCodeAgentSdkQueryRequest(input: {
  prompt: string
  executor: ClaudeCodeExecutorDescriptor
}): ClaudeCodeAgentSdkQueryRequest {
  return {
    prompt: input.prompt,
    options: createClaudeCodeAgentSdkOptions(input.executor)
  }
}

export function createClaudeCodeAgentSdkStartupRequest(
  executor: ClaudeCodeExecutorDescriptor
): ClaudeCodeAgentSdkStartupRequest {
  return {
    options: createClaudeCodeAgentSdkOptions(executor)
  }
}

export function createClaudeCodeAgentSdkOptions(
  executor: ClaudeCodeExecutorDescriptor,
  options: { additionalMcpServers?: Record<string, unknown> } = {}
): ClaudeCodeAgentSdkOptions {
  const externalMcpServers =
    executor.metadata.mcpServers.length > 0 ? buildMcpServers(executor.metadata.mcpServers) : {}
  const mcpServers: Record<string, unknown> | undefined =
    Object.keys(externalMcpServers).length > 0 || Object.keys(options.additionalMcpServers ?? {}).length > 0
      ? { ...externalMcpServers, ...(options.additionalMcpServers ?? {}) }
      : undefined

  return {
    model: executor.sdkOptions.model,
    cwd: executor.sdkOptions.cwd,
    env: { ...executor.sdkOptions.env },
    permissionMode: executor.sdkOptions.permissionMode,
    ...(executor.sdkOptions.thinking ? { thinking: { ...executor.sdkOptions.thinking } } : {}),
    ...(executor.sdkOptions.effort ? { effort: executor.sdkOptions.effort } : {}),
    allowedTools: [
      ...executor.sdkOptions.allowedTools,
      ...executor.metadata.skillToolIds,
      ...(executor.metadata.runtimeMcpToolNames ?? [])
    ],
    disallowedTools: [...executor.sdkOptions.disallowedTools],
    ...(executor.sdkOptions.abortController ? { abortController: executor.sdkOptions.abortController } : {}),
    ...(executor.sdkOptions.resume ? { resume: executor.sdkOptions.resume } : {}),
    ...(executor.sdkOptions.outputFormat ? { outputFormat: cloneOutputFormat(executor.sdkOptions.outputFormat) } : {}),
    ...(executor.sdkOptions.stderr ? { stderr: executor.sdkOptions.stderr } : {}),
    strictMcpConfig: true,
    ...(executor.sdkOptions.permissionMode === 'bypassPermissions'
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    ...(mcpServers ? { mcpServers } : {}),
    canUseTool: async (toolName, input, context) => {
      const decision = await executor.toolHooks.canUseTool(toolName)
      if (decision.behavior === 'allow') {
        return {
          behavior: 'allow',
          updatedInput: input,
          ...(context.toolUseID ? { toolUseID: context.toolUseID } : {})
        }
      }

      return {
        behavior: 'deny',
        message: decision.message,
        ...(context.toolUseID ? { toolUseID: context.toolUseID } : {})
      }
    },
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            async (event) => {
              const decision = await executor.toolHooks.preToolUse({
                toolName: event.tool_name,
                toolCallId: event.tool_use_id,
                input: event.tool_input
              })

              if (decision.behavior === 'allow') {
                return {
                  continue: true,
                  decision: 'approve',
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'allow',
                    ...(decision.updatedInput !== undefined ? { updatedInput: decision.updatedInput } : {})
                  }
                }
              }

              return {
                continue: false,
                decision: 'block',
                reason: decision.message,
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: decision.message
                }
              }
            }
          ]
        }
      ]
    }
  }
}

function buildMcpServers(
  servers: readonly ClaudeCodeMcpServerConfig[]
): Record<string, ClaudeCodeAgentSdkMcpServer> {
  return Object.fromEntries(
    servers.map((server) => {
      if (server.transport === 'stdio') {
        return [
          server.serverName,
          {
            type: 'stdio',
            command: server.command,
            ...(server.args.length > 0 ? { args: [...server.args] } : {}),
            ...(server.env ? { env: { ...server.env } } : {})
          } satisfies ClaudeCodeAgentSdkMcpServer
        ]
      }

      return [
        server.serverName,
        {
          type: 'http',
          url: server.url,
          ...(server.headers ? { headers: { ...server.headers } } : {})
        } satisfies ClaudeCodeAgentSdkMcpServer
      ]
    })
  )
}

function cloneOutputFormat(
  outputFormat: NonNullable<ClaudeCodeExecutorDescriptor['sdkOptions']['outputFormat']>
): NonNullable<ClaudeCodeAgentSdkOptions['outputFormat']> {
  return {
    ...outputFormat,
    schema: { ...outputFormat.schema }
  }
}
