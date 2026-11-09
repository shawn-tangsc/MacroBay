import { useEffect, useState } from 'react'

import { Button, Input } from 'antd'
import { Check, X } from 'lucide-react'

import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'

import { resolveApprovalInputDraft } from '../agentRuntimeApprovalInput'
import type { AgentRuntimeActivityCard } from '../agentRuntimeActivityViewModel'
import { useAgentText } from '../agentTextProvider'

export function ApprovalActions({
  card,
  onRuntimeSnapshotChange
}: {
  card: AgentRuntimeActivityCard
  onRuntimeSnapshotChange: (snapshot: AgentSessionRuntimeSnapshot) => void
}): React.ReactElement {
  const t = useAgentText()
  const approvalInputText = card.approvalInputText ?? null
  const [draftInputText, setDraftInputText] = useState(approvalInputText ?? '')
  /** 只存「有没有失败」，原因句在渲染时取——存句子会让它冻结在写入那一刻的语言。 */
  const [inputInvalid, setInputInvalid] = useState(false)

  useEffect(() => {
    setDraftInputText(approvalInputText ?? '')
    setInputInvalid(false)
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
              setInputInvalid(false)
            }}
          />
          {inputInvalid ? (
            <span className="agent-runtime-activity-input-error">{t.runtimeActivity.invalidInputJson}</span>
          ) : null}
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
                setInputInvalid(true)
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

export async function resolveApproval(
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
