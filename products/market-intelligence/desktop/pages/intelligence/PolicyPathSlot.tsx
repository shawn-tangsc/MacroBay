import { createPortal } from 'react-dom'

import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { PolicyPathBlocked, PolicyPathCard, PolicyPathLoading, type PolicyPathBlock, type PolicyPathCardText } from './PolicyPathCard'
import { policyPathMonth } from './policyPathMonth'
import type { PolicyPathBlockCause, PolicyPathRender } from './dashboardPolicyPathBlock'

/**
 * 利率路径卡在右栏的**唯一落点**：卡片 / 加载 / 五种缺读数，全在这里画，宿主只给状态与落点。
 *
 * 抽出来的理由：看板那一个文件已经贴着 500 行门禁，而这张卡的六态会把判定与 JSX 一起塞进去；
 * 判定在 `dashboardPolicyPathBlock.ts`（纯函数、可测），这里只管把结论换成元素与动作。
 */
export function PolicyPathSlot({ text, render, reading, slot, locale, cellLabel, scheduleLabel, onOpen, onEnableCell, onEnableSchedule, onRunSchedule, onRetry }: Readonly<{
  text: PolicyPathCardText
  render: PolicyPathRender
  reading?: PolicyPathReading
  /** 右栏那个挂载点；没有时退回页面流。 */
  slot?: HTMLDivElement | null
  locale: 'zh-CN' | 'en-US'
  cellLabel: string
  scheduleLabel: string
  onOpen: () => void
  onEnableCell: () => void
  onEnableSchedule: () => void
  onRunSchedule: () => void
  onRetry: () => void
}>): React.ReactNode {
  const card = render.kind === 'card' && reading !== undefined
    ? <PolicyPathCard reading={reading} text={text} month={policyPathMonth(reading.meetingDate, locale)} onOpen={onOpen} />
    : render.kind === 'loading'
      ? <PolicyPathLoading text={text} />
      : render.kind === 'blocked'
        ? <PolicyPathBlocked text={text} block={blockOf(render.block, { cellLabel, scheduleLabel, onEnableCell, onEnableSchedule, onRunSchedule, onRetry })} />
        : null
  if (card === null) return null
  return slot ? createPortal(card, slot) : card
}

function blockOf(cause: PolicyPathBlockCause, input: Readonly<{
  cellLabel: string
  scheduleLabel: string
  onEnableCell: () => void
  onEnableSchedule: () => void
  onRunSchedule: () => void
  onRetry: () => void
}>): PolicyPathBlock {
  switch (cause.kind) {
    case 'cell-off':
      return { kind: 'cell-off', label: input.cellLabel, onAction: input.onEnableCell }
    case 'source-disabled':
      return { kind: 'source-disabled', label: input.scheduleLabel, onAction: input.onEnableSchedule }
    case 'schedule-not-read':
      return { kind: 'schedule-not-read', onAction: input.onRunSchedule }
    case 'read-failed':
      return { kind: 'read-failed', onAction: input.onRetry }
    case 'unavailable':
      return { kind: 'unavailable' }
  }
}
