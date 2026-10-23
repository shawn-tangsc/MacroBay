import type { AgentRuntimeComposition } from '../AgentRuntimeCompositionService'
import type { AgentSessionRuntimeState } from '../runtimeTypes'
import type { AgentStoreState } from '../../store/agentStore'
import { getSessionMessages } from '../../store/agentStore'
import type { AgentSessionMessageEntity, MessageStats } from '../../schemas/sessionSchemas'
import { buildContextCommandResult } from './buildContextCommandResult'
import { buildCostCommandResult } from './buildCostCommandResult'
import { buildTodosCommandResult } from './buildTodosCommandResult'
import {
  formatAgentRuntimeCommandResultText,
  isAgentRuntimeCommandName,
  type AgentRuntimeCommandName,
  type AgentRuntimeCommandResult,
  type AgentRuntimeTodoItem
} from './agentRuntimeCommandTypes'

export type AgentRuntimeCommandExecuteInput = {
  command: AgentRuntimeCommandName | string
  agentId: string
  sessionId: string
  state: AgentStoreState
  composition?: AgentRuntimeComposition | null
  runtimeSession?: AgentSessionRuntimeState | null
  runtimeRoute?: string | null
  todos?: AgentRuntimeTodoItem[]
}

export type AgentRuntimeCommandExecuteOutput = {
  command: AgentRuntimeCommandName
  result: AgentRuntimeCommandResult
  text: string
}

export class AgentRuntimeCommandService {
  execute(input: AgentRuntimeCommandExecuteInput): AgentRuntimeCommandExecuteOutput {
    if (!isAgentRuntimeCommandName(input.command)) {
      throw new Error(`Unsupported runtime command: ${input.command}`)
    }

    const result = this.buildResult(input.command, input)
    return {
      command: input.command,
      result,
      text: formatAgentRuntimeCommandResultText(result)
    }
  }

  private buildResult(
    command: AgentRuntimeCommandName,
    input: AgentRuntimeCommandExecuteInput
  ): AgentRuntimeCommandResult {
    switch (command) {
      case '/context':
        return this.buildContext(input)
      case '/cost':
        return this.buildCost(input)
      case '/todos':
        return buildTodosCommandResult({ todos: input.todos ?? [] })
    }
  }

  private buildContext(input: AgentRuntimeCommandExecuteInput): AgentRuntimeCommandResult {
    const agent = input.state.agents.find((item) => item.id === input.agentId)
    const session = input.state.sessions.find((item) => item.id === input.sessionId)
    const messages = getSessionMessages(input.state, input.sessionId)
    const composition = input.composition

    return buildContextCommandResult({
      agentName: agent?.name?.trim() || input.agentId,
      agentType: agent?.type ?? composition?.agentType ?? 'unknown',
      sessionName: session?.name?.trim() || input.sessionId,
      sessionId: input.sessionId,
      workspacePath: composition?.workspacePath ?? session?.workspace?.path ?? null,
      workspaceType: composition?.workspaceType ?? session?.workspace?.type ?? null,
      runtimeRoute: input.runtimeRoute ?? null,
      warmState: input.runtimeSession?.warmState ?? null,
      enabledMcpCount: composition?.mcp.servers.length ?? agent?.mcps?.length ?? 0,
      enabledSkillCount: composition?.skills.skills.length ?? 0,
      enabledToolCount: composition?.tools.enabled.length ?? 0,
      recentMessageCount: messages.length
    })
  }

  private buildCost(input: AgentRuntimeCommandExecuteInput): AgentRuntimeCommandResult {
    const messages = getSessionMessages(input.state, input.sessionId)
    const totals = sumMessageStats(messages)
    return buildCostCommandResult({
      messageCount: messages.length,
      ...totals
    })
  }
}

function sumMessageStats(messages: readonly AgentSessionMessageEntity[]): {
  promptTokens: number
  completionTokens: number
  thoughtsTokens: number
  totalTokens: number
  messagesWithStats: number
} {
  let promptTokens = 0
  let completionTokens = 0
  let thoughtsTokens = 0
  let totalTokens = 0
  let messagesWithStats = 0

  for (const message of messages) {
    const stats = message.stats
    if (!stats || !hasAnyTokenStat(stats)) continue
    messagesWithStats += 1
    promptTokens += asTokenCount(stats.promptTokens)
    completionTokens += asTokenCount(stats.completionTokens)
    thoughtsTokens += asTokenCount(stats.thoughtsTokens)
    totalTokens += asTokenCount(stats.totalTokens) || asTokenCount(stats.promptTokens) + asTokenCount(stats.completionTokens)
  }

  return { promptTokens, completionTokens, thoughtsTokens, totalTokens, messagesWithStats }
}

function hasAnyTokenStat(stats: MessageStats): boolean {
  return (
    asTokenCount(stats.totalTokens) > 0 ||
    asTokenCount(stats.promptTokens) > 0 ||
    asTokenCount(stats.completionTokens) > 0 ||
    asTokenCount(stats.thoughtsTokens) > 0
  )
}

function asTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}
