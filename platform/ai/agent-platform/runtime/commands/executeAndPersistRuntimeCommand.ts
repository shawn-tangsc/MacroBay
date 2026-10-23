import type { AgentRuntimeComposition } from '../AgentRuntimeCompositionService'
import type { AgentSessionRuntimeSnapshot } from '../runtimeTypes'
import type { AgentStoreState } from '../../store/agentStore'
import { addAgentSessionMessage } from '../../store/agentStore'
import {
  AgentRuntimeCommandService,
  type AgentRuntimeCommandExecuteOutput
} from './AgentRuntimeCommandService'
import type { AgentRuntimeCommandName, AgentRuntimeTodoItem } from './agentRuntimeCommandTypes'
import { isAgentRuntimeCommandName } from './agentRuntimeCommandTypes'

export type ExecuteAndPersistRuntimeCommandInput = {
  command: AgentRuntimeCommandName | string
  agentId: string
  sessionId: string
  state: AgentStoreState
  composition?: AgentRuntimeComposition | null
  runtimeSnapshot?: AgentSessionRuntimeSnapshot | null
  runtimeRoute?: string | null
  todos?: AgentRuntimeTodoItem[]
  commandService?: AgentRuntimeCommandService
}

export type ExecuteAndPersistRuntimeCommandResult = {
  state: AgentStoreState
  output: AgentRuntimeCommandExecuteOutput
  messageId: string
}

export function createAgentRuntimeCommandMessageData(output: AgentRuntimeCommandExecuteOutput) {
  return {
    parts: [
      {
        type: 'agent-runtime-command-result',
        command: output.command,
        result: output.result,
        text: output.text
      },
      {
        type: 'text',
        text: output.text
      }
    ]
  }
}

export function executeAndPersistRuntimeCommand(
  input: ExecuteAndPersistRuntimeCommandInput
): ExecuteAndPersistRuntimeCommandResult {
  if (!isAgentRuntimeCommandName(input.command)) {
    throw new Error(`Unsupported runtime command: ${input.command}`)
  }

  const service = input.commandService ?? new AgentRuntimeCommandService()
  const output = service.execute({
    command: input.command,
    agentId: input.agentId,
    sessionId: input.sessionId,
    state: input.state,
    composition: input.composition,
    runtimeSession: input.runtimeSnapshot?.sessions[input.sessionId] ?? null,
    runtimeRoute: input.runtimeRoute,
    todos: input.todos
  })

  const messageId = `runtime-command-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const nextState = addAgentSessionMessage(input.state, input.sessionId, {
    id: messageId,
    role: 'assistant',
    status: 'success',
    data: createAgentRuntimeCommandMessageData(output)
  })

  return {
    state: nextState,
    output,
    messageId
  }
}
