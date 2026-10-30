import { useEffect, useState } from 'react'

import { Button, Input } from 'antd'
import { AlertTriangle, Brain, Check, ChevronDown, ShieldQuestion, TerminalSquare, X, Zap } from 'lucide-react'

import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import { LoadingSpinner } from '@platform/ui/components/loading'

import type { AgentRuntimeActivityCard } from '../agentRuntimeActivityViewModel'
import { formatAgentElapsed } from '../agentElapsedText'
import { resolveApprovalInputDraft } from '../agentRuntimeApprovalInput'
import { useAgentLanguage, useAgentText } from '../agentTextProvider'
import AgentAskUserQuestionCard from './AgentAskUserQuestionCard'

type AgentRuntimeActivityPanelProps = {
  cards: AgentRuntimeActivityCard[]
  onRuntimeSnapshotChange: (snapshot: AgentSessionRuntimeSnapshot) => void
  /** Wall-clock duration of the turn; shown in the collapsed summary. */
  elapsedMs?: number
  running?: boolean
  failure?: { message: string; code?: string | null } | null
}

export default function AgentRuntimeActivityPanel({
  cards,
  onRuntimeSnapshotChange,
  elapsedMs,
  running = false,
  failure
}: AgentRuntimeActivityPanelProps): React.ReactElement | null {
  const t = useAgentText()
  const language = useAgentLanguage()
  if (cards.length === 0 && !failure) return null
  const items = dedupeActivityCards(cards)
  const hasPendingApproval = items.some((card) => card.kind === 'approval' && card.status === 'pending')
  const groupKind = items.some((card) => card.kind !== 'reasoning') ? 'execution' : 'reasoning'
  const summary = running
    ? t.runtimeActivity.runningTitle
    : failure
      ? t.runtimeActivity.failureTitle
      : elapsedMs !== undefined
        ? t.runtimeActivity.completedIn(formatAgentElapsed(elapsedMs, language))
        : t.runtimeActivity.completedSummary

  return (
    <details
      className="agent-runtime-activity-panel"
      aria-label={t.runtimeActivity.title}
      open={running || hasPendingApproval || Boolean(failure) || undefined}>
      <summary className="agent-runtime-activity-heading">
        <Zap size={13} />
        <strong>{summary}</strong>
        <ChevronDown className="agent-runtime-activity-chevron" size={13} aria-hidden="true" />
      </summary>
      <div className="agent-runtime-activity-list">
        {items.length > 0 ? (
          <details className={`agent-runtime-activity-group ${groupKind}`} open={running || hasPendingApproval || Boolean(failure) || undefined}>
            <summary>
              <span className="agent-runtime-activity-icon">{renderActivityGroupIcon(groupKind)}</span>
              <strong>{groupKind === 'reasoning' ? t.runtimeActivity.reasoningGroupTitle : t.runtimeActivity.executionGroupTitle}</strong>
              <ChevronDown className="agent-runtime-activity-chevron" size={12} aria-hidden="true" />
            </summary>
            <div className="agent-runtime-activity-group-items">
              {items.map((card) =>
                card.kind === 'approval' && card.title === 'AskUserQuestion' && card.approvalInputText && card.approvalId ? (
                  <AgentAskUserQuestionCard
                    key={card.key}
                    inputText={card.approvalInputText}
                    labels={{
                      title: t.runtimeActivity.questionTitle,
                      freeform: t.runtimeActivity.questionFreeform,
                      skip: t.runtimeActivity.questionSkip,
                      submit: t.runtimeActivity.questionSubmit,
                      recommended: t.runtimeActivity.questionRecommended
                    }}
                    onResolve={async (decision: { behavior: 'allow'; updatedInput?: unknown } | { behavior: 'deny'; message: string }) => {
                      let approvalId = card.approvalId
                      if (!approvalId && card.toolCallId) {
                        const snapshot = await window.platform.agents.getRuntimeSnapshot()
                        approvalId = (snapshot as AgentSessionRuntimeSnapshot).toolApprovals.find(
                          (approval) => approval.toolCallId === card.toolCallId
                        )?.approvalId ?? null
                      }
                      if (!approvalId) throw new Error('找不到这条待审批的工具调用，可能已经处理过了。')
                      await resolveApproval(approvalId, decision, onRuntimeSnapshotChange)
                    }}
                  />
                ) : (
                  <ActivityItem key={card.key} card={card} onRuntimeSnapshotChange={onRuntimeSnapshotChange} />
                )
              )}
            </div>
          </details>
        ) : null}
        {failure ? (
          <div className="agent-chat-trace-failure" role="alert">
            <span className="agent-chat-trace-failure__dot" aria-hidden="true" />
            <strong>{t.runtimeActivity.failureTitle}</strong>
            <span className="agent-chat-trace-failure__message">{failure.message}</span>
            {failure.code ? <code>{failure.code}</code> : null}
          </div>
        ) : null}
      </div>
    </details>
  )
}

function ActivityItem({
  card,
  onRuntimeSnapshotChange
}: {
  card: AgentRuntimeActivityCard
  onRuntimeSnapshotChange: (snapshot: AgentSessionRuntimeSnapshot) => void
}): React.ReactElement {
  const t = useAgentText()
  const isTool = card.kind === 'tool'
  const errorPreview =
    isTool && (card.status === 'error' || card.status === 'denied') ? firstLine(card.detail) : null
  return (
    <details className={`agent-runtime-activity-group-item ${card.kind} ${card.status}`}>
      <summary>
        <span className="agent-runtime-activity-row">
          <span className="agent-runtime-activity-icon">{renderCardIcon(card)}</span>
          <strong>{card.title}</strong>
          {isTool && card.subtitle ? (
            <span className="agent-runtime-activity-summary" title={card.subtitle}>
              {card.subtitle}
            </span>
          ) : null}
          <span className={`agent-runtime-activity-status ${card.status}`}>{statusLabel(card.status, t.runtimeActivity)}</span>
        </span>
        {errorPreview ? <span className="agent-runtime-activity-error">{errorPreview}</span> : null}
      </summary>
      {isTool ? null : <small>{card.subtitle}</small>}
      {card.kind === 'approval' && card.approvalNotice ? (
        <p className="agent-runtime-activity-approval-notice">{card.approvalNotice}</p>
      ) : null}
      {card.kind === 'approval' && card.approvalFields?.length ? (
        <dl className="agent-runtime-activity-approval-fields">
          {card.approvalFields.map((field, index) => (
            <div key={`${field.label}:${index}`}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {card.requestDetail ? (
        <details className="agent-runtime-activity-detail-fold">
          <summary>{t.runtimeActivity.input}</summary>
          <pre>{card.requestDetail}</pre>
        </details>
      ) : null}
      {card.detail ? (
        <details className="agent-runtime-activity-detail-fold">
          <summary>{t.runtimeActivity.output}</summary>
          <pre>{card.detail}</pre>
        </details>
      ) : null}
      {card.kind === 'approval' && card.approvalId ? (
        <ApprovalActions card={card} onRuntimeSnapshotChange={onRuntimeSnapshotChange} />
      ) : null}
    </details>
  )
}

/** A failed row earns one line of the reason; the full text stays in the output fold. */
function firstLine(text: string | null): string | null {
  if (!text) return null
  const line = text.split('\n').map((value) => value.trim()).find(Boolean)
  if (!line) return null
  return line.length > 200 ? `${line.slice(0, 200)}…` : line
}

/** The runtime emits one row per tool call and a second row for its approval; keep one per tool. */
function dedupeActivityCards(cards: AgentRuntimeActivityCard[]): AgentRuntimeActivityCard[] {
  const byTool = new Map<string, AgentRuntimeActivityCard>()
  for (const card of cards) {
    if (card.kind === 'assistant-text') continue
    const key = card.toolCallId ? `tool:${card.toolCallId}` : card.key
    const existing = byTool.get(key)
    if (!existing) {
      byTool.set(key, card)
      continue
    }
    const preferred = card.kind === 'approval' && existing.kind !== 'approval' ? card : existing
    byTool.set(key, {
      ...preferred,
      detail: preferred.detail ?? existing.detail ?? card.detail ?? null,
      requestDetail:
        preferred.requestDetail ?? existing.requestDetail ?? card.requestDetail ?? null
    })
  }
  return [...byTool.values()]
}

function ApprovalActions({
  card,
  onRuntimeSnapshotChange
}: {
  card: AgentRuntimeActivityCard
  onRuntimeSnapshotChange: (snapshot: AgentSessionRuntimeSnapshot) => void
}): React.ReactElement {
  const t = useAgentText()
  const approvalInputText = card.approvalInputText ?? null
  const [draftInputText, setDraftInputText] = useState(approvalInputText ?? '')
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => {
    setDraftInputText(approvalInputText ?? '')
    setInputError(null)
  }, [approvalInputText, card.approvalId])

  const hasEditableInput = Boolean(approvalInputText)
  const hasDraftChange =
    hasEditableInput &&
    draftInputText.trim().length > 0 &&
    draftInputText.trim() !== approvalInputText!.trim()

  return (
    <>
      {approvalInputText ? (
        <label className="agent-runtime-activity-input-editor">
          <span>{t.runtimeActivity.editInput}</span>
          <Input.TextArea
            value={draftInputText}
            spellCheck={false}
            autoSize={{ minRows: 3, maxRows: 8 }}
            onChange={(event) => {
              setDraftInputText(event.target.value)
              setInputError(null)
            }}
          />
          {inputError ? <span className="agent-runtime-activity-input-error">{inputError}</span> : null}
        </label>
      ) : null}
      <div className="agent-runtime-activity-actions">
        <Button
          className="ant-primary-button"
          size="small"
          icon={<Check size={13} />}
          onClick={() => resolveApproval(card.approvalId!, { behavior: 'allow' }, onRuntimeSnapshotChange)}>
          {approvalInputText ? t.runtimeActivity.allowOriginalInput : t.runtimeActivity.allow}
        </Button>
        {approvalInputText ? (
          <Button
            className="ant-secondary-button"
            size="small"
            icon={<Check size={13} />}
            disabled={!hasDraftChange}
            onClick={() => {
              const resolution = resolveApprovalInputDraft(approvalInputText, draftInputText)
              if (resolution.kind === 'invalid') {
                setInputError(t.runtimeActivity.invalidInputJson)
                return
              }
              if (resolution.kind === 'original') {
                resolveApproval(card.approvalId!, { behavior: 'allow' }, onRuntimeSnapshotChange)
                return
              }
              resolveApproval(
                card.approvalId!,
                { behavior: 'allow', updatedInput: resolution.updatedInput },
                onRuntimeSnapshotChange
              )
            }}>
            {t.runtimeActivity.allowWithEditedInput}
          </Button>
        ) : null}
        <Button
          className="ant-secondary-button"
          size="small"
          icon={<X size={13} />}
          onClick={() => {
            resolveApproval(
              card.approvalId!,
              {
                behavior: 'deny',
                message: t.runtimeActivity.denyMessage
              },
              onRuntimeSnapshotChange
            )
          }}>
          {t.runtimeActivity.deny}
        </Button>
      </div>
    </>
  )
}

async function resolveApproval(
  approvalId: string,
  decision: { behavior: 'allow'; updatedInput?: unknown } | { behavior: 'deny'; message: string },
  onRuntimeSnapshotChange: (snapshot: AgentSessionRuntimeSnapshot) => void
): Promise<void> {
  const before = (await window.platform.agents.getRuntimeSnapshot()) as AgentSessionRuntimeSnapshot
  if (!before.toolApprovals.some((approval) => approval.approvalId === approvalId)) {
    throw new Error('这条审批已经处理过或已过期，请等待智能体刷新。')
  }
  const snapshot = await window.platform.agents.resolveToolApproval(approvalId, decision)
  onRuntimeSnapshotChange(snapshot as AgentSessionRuntimeSnapshot)
}

function renderCardIcon(card: AgentRuntimeActivityCard): React.ReactElement {
  if (card.status === 'error' || card.status === 'denied') return <AlertTriangle size={14} />
  if (card.kind === 'approval') return <ShieldQuestion size={14} />
  if (card.kind === 'reasoning') return <Brain size={14} />
  if (card.kind === 'control') return <Zap size={14} />
  if (card.kind === 'assistant-text') return <LoadingSpinner size="sm" />
  return <TerminalSquare size={14} />
}

function renderActivityGroupIcon(groupKind: 'reasoning' | 'execution'): React.ReactElement {
  return groupKind === 'reasoning' ? <Brain size={14} /> : <TerminalSquare size={14} />
}

function statusLabel(
  status: AgentRuntimeActivityCard['status'],
  text: {
    pending: string
    running: string
    done: string
    error: string
    denied: string
  }
): string {
  return text[status]
}
