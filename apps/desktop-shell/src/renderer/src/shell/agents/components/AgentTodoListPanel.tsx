import { AlertTriangle, Check, ChevronDown, Circle, Wrench } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { LoadingSpinner } from '@platform/ui/components/loading'

import type { AgentText } from '../agentText'
import { useAgentLanguage, useAgentText } from '../agentTextProvider'
import { formatAgentElapsed } from '../agentElapsedText'
import { AGENT_STILL_WAITING_THRESHOLD_MS } from '../agentRuntimePhaseText'
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

/** Clock context for the responding row; omitted by callers that only need the skeleton. */
export type TodoElapsedContext = {
  nowMs: number
  language: AppLanguage
}

export default function AgentTodoListPanel({
  agent,
  session,
  messages,
  narrow = false
}: AgentTodoListPanelProps): React.ReactElement | null {
  const t = useAgentText()
  const language = useAgentLanguage()
  const [expanded, setExpanded] = useState(false)
  // This panel has no turn-state prop, so a pending assistant message is the running signal.
  const pendingStartedAt = useMemo(() => resolvePendingAssistantStartedAt(messages), [messages])
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (pendingStartedAt === undefined) return
    setNowMs(Date.now())
    const intervalId = setInterval(() => setNowMs(Date.now()), 10_000)
    return () => clearInterval(intervalId)
  }, [pendingStartedAt])
  const items = useMemo(
    () => buildTodoItems(agent, session, messages, t.todos, { nowMs, language }),
    [agent, language, messages, nowMs, session, t.todos]
  )
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
  text: AgentText['todos'],
  elapsed?: TodoElapsedContext
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
  const pendingElapsedMs = hasPending
    ? resolveElapsedMs(findLatestPendingAssistant(relevantAssistantMessages), elapsed)
    : undefined

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
        ? buildRespondingLabel(text, pendingElapsedMs, elapsed?.language ?? 'zh-CN')
        : hasError
          ? text.responseNeedsErrorHandling
          : hasAssistantSuccess
            ? text.agentResponseCompleted
            : text.waitingAgentResponse,
      status: hasPending ? 'in_progress' : hasError ? 'error' : hasAssistantSuccess ? 'completed' : 'pending'
    }
  ]
}

function buildRespondingLabel(
  text: AgentText['todos'],
  elapsedMs: number | undefined,
  language: AppLanguage
): string {
  if (elapsedMs === undefined) return text.agentResponding
  if (elapsedMs >= AGENT_STILL_WAITING_THRESHOLD_MS) {
    return `${text.agentResponding} · ${text.stillWaiting}`
  }
  return `${text.agentResponding} · ${text.elapsed(formatAgentElapsed(elapsedMs, language))}`
}

function resolveElapsedMs(
  pendingAssistant: AgentSessionMessageEntity | undefined,
  elapsed: TodoElapsedContext | undefined
): number | undefined {
  if (!pendingAssistant || !elapsed) return undefined
  const startedAt = Date.parse(pendingAssistant.createdAt)
  if (!Number.isFinite(startedAt)) return undefined
  return Math.max(0, elapsed.nowMs - startedAt)
}

function findLatestPendingAssistant(
  messages: readonly AgentSessionMessageEntity[]
): AgentSessionMessageEntity | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.status === 'pending') return message
  }
  return undefined
}

/** Newest assistant row decides: a finished reply means the earlier pending row is stale. */
function resolvePendingAssistantStartedAt(
  messages: readonly AgentSessionMessageEntity[]
): number | undefined {
  const ordered = sortAgentSessionMessages(messages)
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const message = ordered[index]
    if (!message || message.role !== 'assistant') continue
    if (message.status !== 'pending') return undefined
    const startedAt = Date.parse(message.createdAt)
    return Number.isFinite(startedAt) ? startedAt : undefined
  }
  return undefined
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
