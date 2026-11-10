import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import type { SafeIntelligenceSourceDetailView } from '../../../service/intelligence/schema/intelligenceSourcesContracts'
import {
  computeSourceHealthDetail,
  type SourceHealthIdleReason,
  type SourceRunNowAnswer
} from './sourceHealthCells'

/**
 * 一个源的详情读取状态。
 *
 * `skipped` 是**日历 feed**：它只在日历的注册表里，通用源服务没有它的详情——问一次只会得到
 * 「未知来源」。所以这里不读、也不把它画成「读失败」或「没有数据」，四格里读不到的那两格写
 * 「未知」并说明原因（「没有」与「拿不到」是两件事）。
 */
export type SourceDetailRead =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'ready'; detail: SafeIntelligenceSourceDetailView }>
  | Readonly<{ state: 'failed' }>
  | Readonly<{ state: 'skipped' }>

export type SourceHealthLabels = Readonly<{
  todayReading: string
  todayReadingYes: string
  todayReadingNo: string
  lastSuccessAt: string
  noSuccess: string
  unknown: string
  unknownReason: string
  whyNotCollecting: string
  runNowAnswer: string
  /** 原因码 → 读者说法（英文界面也走同一份，正文里不出现码）。 */
  unavailableReasons: Readonly<Record<string, string>>
  reasons: Readonly<Record<SourceHealthIdleReason, string>>
  runNow: Readonly<Record<SourceRunNowAnswer, string>>
}>

/**
 * B4 四格：今天有没有读数 / 上次成功 / 为什么没在采 / 能不能立刻采。
 *
 * 判据全在 `sourceHealthCells`（纯函数、只吃投影事实）；这里只做「枚举 → 文案键」映射与版式。
 * 草稿：读取失败必须是**错误态 + 重试**，不许画成「没有数据」；日历 feed 不读通用详情，
 * 读不到的两格写「未知」并说明这是拿不到、不是没有。
 */
export function SourceHealthDetail(props: {
  labels: SourceHealthLabels
  read: SourceDetailRead
  source: SourceView
  /** 目录声明的「平台允许立即运行」；日历 feed 没有目录声明就是 `undefined`。 */
  supportsRunNow?: boolean
  onRetry: () => void
  resolveText: (key: string) => string
  /** 不可用源的整组说明里那一句（「自动同步已停止」）；与原因句串在同一格。 */
  automaticSyncStopped: string
  timeZone: string
}): React.ReactElement | null {
  const { labels, read, source } = props
  // 详情还在读：这一块先不画。整页已经有统一的首次加载态（`LoadingState`），
  // 每个源再挂一枚转圈只会把一屏变成一排等待区。
  if (read.state === 'loading') return null

  if (read.state === 'failed') {
    return <div className="source-provider-detail__health" data-source-health={source.sourceId} data-health-read="failed">
      <StateView
        action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: props.onRetry }}
        reasonCode="unreadable"
        size="sm"
        state="error"
      />
    </div>
  }

  const detail = read.state === 'ready' ? read.detail : undefined
  const view = computeSourceHealthDetail({
    source,
    ...(detail === undefined ? {} : { profile: detail.profile, health: detail.health, credentialStatus: detail.credentialStatus }),
    ...(props.supportsRunNow === undefined ? {} : { supportsRunNow: props.supportsRunNow }),
    now: new Date(),
    timeZone: props.timeZone
  })

  const todayValue = view.today.kind === 'yes'
    ? labels.todayReadingYes.replace('{time}', view.today.time)
    : view.today.kind === 'no' ? labels.todayReadingNo : labels.unknown
  const lastSuccessValue = view.lastSuccess.kind === 'known'
    ? view.lastSuccess.text
    : view.lastSuccess.kind === 'none' ? labels.noSuccess : labels.unknown

  const unknownReading = view.today.kind === 'unknown' || view.lastSuccess.kind === 'unknown'

  return <div className="source-provider-detail__health" data-source-health={source.sourceId} data-health-read={read.state}>
    <div className="intelligence-health-list">
      <HealthCell cell="today" label={labels.todayReading} unknown={view.today.kind === 'unknown'}>{todayValue}</HealthCell>
      <HealthCell cell="last-success" label={labels.lastSuccessAt} unknown={view.lastSuccess.kind === 'unknown'}>{lastSuccessValue}</HealthCell>
      <HealthCell cell="idle-reason" label={labels.whyNotCollecting}>
        {view.idleReason === 'unavailable'
          ? <UnavailableReason
            automaticSyncStopped={props.automaticSyncStopped}
            reasonCode={view.unavailableReasonCode}
            labels={labels}
            resolveText={props.resolveText} />
          : labels.reasons[view.idleReason]}
      </HealthCell>
      <HealthCell cell="run-now" label={labels.runNowAnswer}>{labels.runNow[view.runNow]}</HealthCell>
    </div>
    {/* 「拿不到」不是「没有」：读不到逐次记录时把原因写在下面，读者不会把「未知」读成「从没采过」。 */}
    {unknownReading ? <p className="intelligence-source-note intelligence-source-note--health">{labels.unknownReason}</p> : null}
  </div>
}

function HealthCell(props: {
  cell: 'today' | 'last-success' | 'idle-reason' | 'run-now'
  label: string
  unknown?: boolean
  children: React.ReactNode
}): React.ReactElement {
  return <div className="intelligence-health-item" data-health-cell={props.cell}>
    <span className="intelligence-health-label">{props.label}</span>
    <strong className="intelligence-health-value" {...(props.unknown === true ? { 'data-unknown': 'true' } : {})}>
      {props.children}
    </strong>
  </div>
}

/** 不可用原因：正文一句人话（与「自动同步已停止」串起来），码只进 ⓘ、恰一处。 */
function UnavailableReason(props: {
  automaticSyncStopped: string
  labels: SourceHealthLabels
  reasonCode?: string
  resolveText: (key: string) => string
}): React.ReactElement {
  const reasonCode = props.reasonCode ?? ''
  // 表里没有的码退回不带数字的那句，永远不抛错；也不从码里截数字（码名一改，403 就变了）。
  const sentence = props.labels.unavailableReasons[reasonCode]
    ?? props.resolveText('settings.intelligenceSources.unavailableShort')
  return <>
    <span>{[sentence, props.automaticSyncStopped].join(' · ')}</span>
    <Popover
      content={<code className="source-provider-detail__reason-code">{reasonCode}</code>}
      trigger={(triggerProps) => (
        <IconButton
          {...triggerProps}
          ariaLabelKey="settings.intelligenceSources.unavailableReasonCodeAria"
          icon={Info}
          resolveText={props.resolveText}
          size="sm"
          variant="plain" />
      )} />
  </>
}
