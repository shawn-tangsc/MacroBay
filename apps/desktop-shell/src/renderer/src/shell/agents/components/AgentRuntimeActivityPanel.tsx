import { useEffect, useState } from 'react'

import { Button, Input } from 'antd'
import { AlertTriangle, Brain, ShieldQuestion, TerminalSquare, Zap } from 'lucide-react'

import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import { LoadingSpinner } from '@platform/ui/components/loading'
import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'

import type { AgentRuntimeActivityCard } from '../agentRuntimeActivityViewModel'
import { formatAgentElapsed } from '../agentElapsedText'
import { resolveApprovalInputDraft } from '../agentRuntimeApprovalInput'
import { useAgentLanguage, useAgentText } from '../agentTextProvider'
import AgentAskUserQuestionCard from './AgentAskUserQuestionCard'
import { ApprovalActions, resolveApproval } from './AgentRuntimeActivityApproval'

/**
 * 壳的 `resolveText` 只被 `*Key` 用到。这些折叠区的头行全是**已解析的原文**
 * （运行时标签、工具副标题、字段名），一个键也不走——给同义回落，误传键时看见的是键本身。
 */
const passthroughText = (key: string): string => key

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
  const items = dedupeActivityCards(cards)
  const hasPendingApproval = items.some((card) => card.kind === 'approval' && card.status === 'pending')
  /**
   * 「运行中 / 待批准 / 失败」时自动展开——但这是**进入状态时的一次动作**，不是每次渲染都执行：
   * 读者手动收起之后，不许被下一次渲染重新弹开（界面设计 2026-11-09 写死）。
   */
  const autoOpen = running || hasPendingApproval || Boolean(failure)
  const [panelOpen, setPanelOpen] = useState(autoOpen)
  const [groupOpen, setGroupOpen] = useState(autoOpen)
  useEffect(() => {
    if (!autoOpen) return
    setPanelOpen(true)
    setGroupOpen(true)
  }, [autoOpen])
  if (cards.length === 0 && !failure && elapsedMs === undefined) return null
  const groupKind = items.some((card) => card.kind !== 'reasoning') ? 'execution' : 'reasoning'
  const summary = running
    ? elapsedMs !== undefined
      ? `${t.runtimeActivity.runningTitle} · ${formatAgentElapsed(elapsedMs, language)}`
      : t.runtimeActivity.runningTitle
    : failure
      ? t.runtimeActivity.failureTitle
      : elapsedMs !== undefined
        ? t.runtimeActivity.completedIn(formatAgentElapsed(elapsedMs, language))
        : t.runtimeActivity.completedSummary

  return (
    <div className="agent-runtime-activity-panel" role="group" aria-label={t.runtimeActivity.title}>
      <CollapsibleGroup
        header={<><Zap size={13} aria-hidden="true" /><strong>{summary}</strong></>}
        onOpenChange={setPanelOpen}
        open={panelOpen}
        resolveText={passthroughText}>
      {items.length > 0 || failure ? (
        <div className="agent-runtime-activity-list">
          {items.length > 0 ? (
            <div className={`agent-runtime-activity-group ${groupKind}`}>
            <CollapsibleGroup
              header={<>
                <span className="agent-runtime-activity-icon">{renderActivityGroupIcon(groupKind)}</span>
                <strong>{groupKind === 'reasoning' ? t.runtimeActivity.reasoningGroupTitle : t.runtimeActivity.executionGroupTitle}</strong>
              </>}
              onOpenChange={setGroupOpen}
              open={groupOpen}
              resolveText={passthroughText}>
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
                        recommended: t.runtimeActivity.questionRecommended,
                        questionPrevious: t.runtimeActivity.questionPrevious,
                        questionNext: t.runtimeActivity.questionNext
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
            </CollapsibleGroup>
            </div>
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
      ) : null}
      </CollapsibleGroup>
    </div>
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
    <div className={`agent-runtime-activity-group-item ${card.kind} ${card.status}`}>
      <CollapsibleGroup
        header={<>
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
        </>}
        resolveText={passthroughText}>
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
      {/* 输入 / 输出：头行就是一行字，直接走壳（原生 `<summary>` 与壳头行同屏会分成两套）。 */}
      {card.requestDetail ? (
        <CollapsibleGroup resolveText={passthroughText} titleText={t.runtimeActivity.input}>
          <pre>{card.requestDetail}</pre>
        </CollapsibleGroup>
      ) : null}
      {card.detail ? (
        <CollapsibleGroup resolveText={passthroughText} titleText={t.runtimeActivity.output}>
          <pre>{card.detail}</pre>
        </CollapsibleGroup>
      ) : null}
      {card.kind === 'approval' && card.approvalId ? (
        <ApprovalActions card={card} onRuntimeSnapshotChange={onRuntimeSnapshotChange} />
      ) : null}
      </CollapsibleGroup>
    </div>
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
