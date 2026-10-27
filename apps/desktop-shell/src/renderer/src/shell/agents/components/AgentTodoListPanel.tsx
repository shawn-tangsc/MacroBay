import { AlertTriangle, Check, ChevronDown, Circle, Wrench } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import { LoadingSpinner } from '@platform/ui/components/loading'

import type { AgentText } from '../agentText'
import { useAgentText } from '../agentTextProvider'
import { sortAgentSessionMessages } from '@platform/ui/agent-chat'

type AgentTodoListPanelProps = {
  agent: AgentEntity
  session: AgentSessionEntity
  messages: AgentSessionMessageEntity[]
  narrow?: boolean
}

export type TodoStatus = 'completed' | 'in_progress' | 'pending' | 'error'

export type TodoItem = {
  id: string
  label: string
  status: TodoStatus
}

export default function AgentTodoListPanel({
  agent,
  session,
  messages,
  narrow = false
}: AgentTodoListPanelProps): React.ReactElement | null {
  const t = useAgentText()
  const [expanded, setExpanded] = useState(false)
  const items = useMemo(() => buildTodoItems(agent, session, messages, t.todos), [agent, messages, session, t.todos])
  if (!shouldShowTodoPanel(items)) return null

  const completed = items.filter((item) => item.status === 'completed').length
  const inProgress = items.some((item) => item.status === 'in_progress')

  return (
    <section className={narrow ? 'agent-todo-panel narrow' : 'agent-todo-panel'}>
      <button type="button" className="agent-todo-header" onClick={() => setExpanded((current) => !current)}>
        <span className="agent-todo-icon">{inProgress ? <LoadingSpinner size="sm" /> : <Wrench size={14} />}</span>
        <strong>{t.todos.title}</strong>
        <small>{completed}/{items.length}</small>
        <ChevronDown size={14} className={expanded ? 'expanded' : ''} />
      </button>
      {expanded ? (
        <div className="agent-todo-list">
          {items.map((item) => (
            <div key={item.id} className={`agent-todo-item ${item.status}`}>
              {item.status === 'completed' ? <Check size={14} /> : null}
              {item.status === 'in_progress' ? <LoadingSpinner size="sm" /> : null}
              {item.status === 'pending' ? <Circle size={14} /> : null}
              {item.status === 'error' ? <AlertTriangle size={14} /> : null}
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export function buildTodoItems(
  agent: AgentEntity,
  session: AgentSessionEntity,
  messages: AgentSessionMessageEntity[],
  text: AgentText['todos']
): TodoItem[] {
  const sortedMessages = sortAgentSessionMessages(messages)
  const latestUserMessageIndex = findLatestUserMessageIndex(sortedMessages)
  const hasUserMessage = latestUserMessageIndex >= 0
  const messagesAfterLatestUser = hasUserMessage ? sortedMessages.slice(latestUserMessageIndex + 1) : []
  const assistantMessages = sortedMessages.filter((message) => message.role === 'assistant')
  const relevantAssistantMessages = hasUserMessage
    ? messagesAfterLatestUser.filter((message) => message.role === 'assistant')
    : assistantMessages.filter((message) => message.status === 'pending')
  const hasAssistantSuccess = relevantAssistantMessages.some((message) => message.status === 'success')
  const hasError = relevantAssistantMessages.some((message) => message.status === 'error')
  const hasPending =
    !hasAssistantSuccess && !hasError && relevantAssistantMessages.some((message) => message.status === 'pending')

  return [
    {
      id: 'workspace',
      label: session.workspace.type === 'system' ? text.systemWorkspace : text.workspaceBound,
      status: 'completed'
    },
    {
      id: 'model',
      label: agent.model ? text.modelSelected(agent.modelName ?? agent.model) : text.selectModel,
      status: agent.model ? 'completed' : 'pending'
    },
    {
      id: 'request',
      label: hasUserMessage ? text.userTaskReceived : text.waitingUserTask,
      status: hasUserMessage ? 'completed' : 'pending'
    },
    {
      id: 'runtime',
      label: hasPending
        ? text.agentResponding
        : hasError
          ? text.responseNeedsErrorHandling
          : hasAssistantSuccess
            ? text.agentResponseCompleted
            : text.waitingAgentResponse,
      status: hasPending ? 'in_progress' : hasError ? 'error' : hasAssistantSuccess ? 'completed' : 'pending'
    }
  ]
}

function findLatestUserMessageIndex(messages: readonly AgentSessionMessageEntity[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index
  }
  return -1
}


export function shouldShowTodoPanel(items: readonly TodoItem[]): boolean {
  const request = items.find((item) => item.id === 'request')
  const runtime = items.find((item) => item.id === 'runtime')
  if (runtime?.status === 'in_progress' || runtime?.status === 'error') return true
  return request?.status === 'completed' && runtime?.status === 'pending'
}
