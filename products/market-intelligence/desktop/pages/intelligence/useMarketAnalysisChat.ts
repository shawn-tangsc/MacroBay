import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentSessionEntity, AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentComposedMessage } from '@renderer/shell/agents/agentMessageSendFlow'
import { analysisWorkspacePolicy, type AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import { navigateAppShell } from '../../shared/navigation/productShellNavigation'

const pendingDraftKey = 'market-analysis-pending'

export function useMarketAnalysisChat(
  binding: AnalysisWorkspaceBinding | undefined,
  sessionName: string,
  /**
   * The selected calendar event: its identity reference, plus an optional reader for the facts the
   * system holds. A reader that fails must not block the question — the reference still travels.
   */
  selectedEventContext?: Readonly<{
    label: string
    detail?: string
    reference: string
    payload?: Record<string, unknown>
    facts?: () => Promise<string>
  }>,
  /** Human title of the selected analysis node; the card falls back to a generic label. */
  analysisContextTitle?: string
) {
  const [state, setState] = useState<AgentStoreState>()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [sessionId, setSessionId] = useState<string>()
  const [inFlightSessionId, setInFlightSessionId] = useState<string>()
  const [runtime, setRuntime] = useState<AgentSessionRuntimeSnapshot>()
  const busy = useRef(false)
  const pendingSessionId = useRef<string | undefined>(undefined)
  const currentBinding = useRef(binding)
  currentBinding.current = binding
  const description = analysisWorkspacePolicy.generalSessionBinding
  const draftKey = sessionId ?? pendingDraftKey
  const draft = drafts[draftKey] ?? ''
  const writeDraft = useCallback((key: string, value: SetStateAction<string>) => {
    setDrafts(current => {
      const text = typeof value === 'function' ? value(current[key] ?? '') : value
      const next = { ...current }
      if (text) next[key] = text
      else delete next[key]
      return next
    })
  }, [])
  const setDraft = useCallback((value: SetStateAction<string>) => {
    writeDraft(draftKey, value)
  }, [draftKey, writeDraft])

  useEffect(() => {
    let alive = true
    const update = (value: unknown) => { if (alive) setState(value as AgentStoreState) }
    void window.platform?.agents?.getState().then(update).catch(() => { if (alive) setFailed(true) })
    const unsubscribe = window.platform?.agents?.onStateChanged(update)
    const updateRuntime = (value: unknown) => { if (alive) setRuntime(value as AgentSessionRuntimeSnapshot) }
    void window.platform?.agents?.getRuntimeSnapshot?.().then(updateRuntime).catch(() => {})
    const unsubscribeRuntime = window.platform?.agents?.onRuntimeStateChanged?.(updateRuntime)
    return () => { alive = false; unsubscribe?.(); unsubscribeRuntime?.() }
  }, [])

  /**
   * Panel conversations are ordinary agent sessions. Selection is deliberately not part of this
   * key: choosing a node changes the next message's context, never the conversation being read.
   */
  const sessions = useMemo<AgentSessionEntity[]>(() => {
    const matching = (state?.sessions ?? []).filter(session => session.agentId === analysisWorkspacePolicy.agentId)
    return [...matching].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }, [state?.sessions])

  useEffect(() => {
    // Keep the reader's current conversation while it still exists; only resolve when it is gone
    // or never chosen. This is what makes the panel reopen on the last used conversation.
    if (sessionId && (sessions.some(session => session.id === sessionId) || pendingSessionId.current === sessionId)) {
      if (sessions.some(session => session.id === sessionId)) pendingSessionId.current = undefined
      return
    }
    setSessionId(sessions[0]?.id)
  }, [sessionId, sessions])

  const createConversation = useCallback(async (): Promise<string> => {
    // The same DTO shape the send path uses: `name` and `workspace` are required.
    const created = await window.platform.agents.createSession({
      agentId: analysisWorkspacePolicy.agentId, name: sessionName, description, workspace: { type: 'system' }
    }) as { id: string } | undefined
    if (!created?.id) throw new Error(analysisWorkspacePolicy.errors.unavailable)
    pendingSessionId.current = created.id
    setSessionId(created.id)
    return created.id
  }, [description, sessionName])

  /** The only way a new conversation is created; the old one stays in the session list. */
  const startNewConversation = useCallback(async () => {
    try {
      await createConversation()
      setFailed(false)
    } catch { setFailed(true) }
  }, [createConversation])

  // Kept for the existing floating control wiring; the action is now a new conversation.
  const clearConversation = startNewConversation

  const selectConversation = useCallback((id: string) => {
    if (!sessions.some(session => session.id === id)) return
    setSessionId(id)
    setFailed(false)
  }, [sessions])

  const deleteConversation = useCallback(async (id: string) => {
    try {
      const next = await window.platform.agents.deleteSessions([id]) as AgentStoreState
      const remaining = sessions.filter(session => session.id !== id)
      if (sessionId === id) setSessionId(remaining[0]?.id)
      if (next?.sessions) setState(next)
      setFailed(false)
    } catch { setFailed(true) }
  }, [sessionId, sessions])

  const currentSession = sessions.find(session => session.id === sessionId)

  const agent = state?.agents.find(candidate => candidate.id === analysisWorkspacePolicy.agentId)
  const messages: AgentSessionMessageEntity[] = sessionId ? state?.messagesBySessionId[sessionId] ?? [] : []
  const operationSessionId = inFlightSessionId ?? sessionId
  const approvals = runtime?.toolApprovals.filter(approval => approval.sessionId === operationSessionId) ?? []
  const running = sending || (sessionId && runtime?.sessions[sessionId]?.turnState !== undefined && runtime.sessions[sessionId].turnState !== 'idle')

  async function openAgent() {
    try {
      if (operationSessionId) await window.platform.agents.selectSession(operationSessionId)
      else await window.platform.agents.selectAgent(analysisWorkspacePolicy.agentId)
      navigateAppShell({ navKey: 'agents' })
    } catch { setFailed(true) }
  }

  async function stop() {
    if (!operationSessionId) return
    try { await window.platform.agents.cancelSession(operationSessionId) } catch { setFailed(true) }
  }

  /**
   * The conversation the reader is in. Opened lazily (on panel open or first question) so a
   * surface can mount the shared composer against a real session.
   */
  const ensureSession = useCallback(async (): Promise<string | undefined> => {
    let id = sessionId
    if (!id) {
      try { id = await createConversation() } catch { id = undefined }
    }
    if (!id) throw new Error(analysisWorkspacePolicy.errors.unavailable)
    setSessionId(id)
    return id
  }, [createConversation, sessionId])

  /**
   * 只附加用户选中的身份引用，不复制后台摘要、工具日志或隐藏提示词。
   * Same shape as the node reference: an identity the agent can look up, never a copy of the
   * analysis prose. An event selection carries the event's own line instead.
   * Runs at send time, so a calendar event's facts are read when asked, not while idle.
   */
  const composeOutgoingText = useCallback(async (text: string): Promise<AgentComposedMessage> => {
    const selectedEvent = selectedEventContext
    const selected = currentBinding.current
    // The chip and the composer must agree. A calendar/event selection is the visible context
    // when both slots briefly exist; the dashboard clears the other slot on every new selection.
    if (selectedEvent) {
      const eventFacts = selectedEvent.facts ? await selectedEvent.facts().catch(() => undefined) : undefined
      return {
        text: `${text}\n\n${eventFacts ? `${eventFacts}\n${selectedEvent.reference}` : selectedEvent.reference}`,
        displayText: text,
        context: {
          kind: 'market-calendar-event',
          label: selectedEvent.label,
          detail: selectedEvent.detail,
          ...(selectedEvent.payload ? { payload: selectedEvent.payload } : {})
        }
      }
    }
    if (selected) {
      return {
        text: `${text}\n\n[eventGroupId=${selected.eventGroupId}; analysisRunId=${selected.analysisRunId}; summaryId=${selected.summaryId}; asOf=${selected.asOf}]`,
        displayText: text,
        context: {
          kind: 'market-analysis-node',
          label: analysisContextTitle?.trim() || 'Context',
          ...(formatContextTime(selected.asOf) ? { detail: formatContextTime(selected.asOf) } : {}),
          payload: {
            eventGroupId: selected.eventGroupId,
            analysisRunId: selected.analysisRunId,
            summaryId: selected.summaryId,
            asOf: selected.asOf
          }
        }
      }
    }
    return text
  }, [analysisContextTitle, selectedEventContext])

  async function send() {
    const submittedDraft = draft
    const submittedDraftKey = draftKey
    const question = submittedDraft.trim()
    if (!question || !agent || busy.current || running) return
    busy.current = true; setSending(true); setFailed(false)
    writeDraft(submittedDraftKey, '')
    let targetDraftKey = submittedDraftKey
    try {
      const id = await ensureSession()
      if (!id) throw new Error(analysisWorkspacePolicy.errors.unavailable)
      targetDraftKey = id
      setInFlightSessionId(id)
      const composed = await composeOutgoingText(question)
      const text = typeof composed === 'string' ? composed : composed.text
      const displayText = typeof composed === 'string' ? undefined : composed.displayText
      const context = typeof composed === 'string' ? undefined : composed.context
      const result = await window.platform.agents.sendMessage({
        agentId: agent.id,
        sessionId: id,
        text,
        ...(displayText ? { displayText } : {}),
        ...(context ? { context } : {})
      }) as { state: AgentStoreState }
      if (!result?.state) throw new Error(analysisWorkspacePolicy.errors.unavailable)
      setState(result.state)
    } catch {
      setFailed(true)
      // Restore the submitted text on the conversation it was actually sent from.
      writeDraft(targetDraftKey, current => current === '' ? submittedDraft : current)
      try { setState(await window.platform.agents.getState() as AgentStoreState) } catch { /* 保留当前消息和草稿供用户检查。 */ }
    } finally { busy.current = false; setSending(false); setInFlightSessionId(undefined) }
  }

  return {
    agent,
    sessionId,
    currentSession,
    sessions,
    messages,
    draft,
    setDraft,
    sending: Boolean(running),
    failed,
    send,
    approvals,
    openAgent,
    stop,
    startNewConversation,
    selectConversation,
    deleteConversation,
    clearConversation,
    ensureSession,
    composeOutgoingText
  }
}

function formatContextTime(asOf: string): string | undefined {
  const date = new Date(asOf)
  if (Number.isNaN(date.getTime())) return undefined
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
