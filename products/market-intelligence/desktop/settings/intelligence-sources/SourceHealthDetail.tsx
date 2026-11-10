import { Button } from 'antd'
import { Info } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import type { SourceView } from '../../../service/intelligence/application/sourceProjection'
import { SOURCE_UNAVAILABLE_FALLBACK_KEY, sourceUnavailableSentence } from '../../shared/i18n/sourceUnavailableCopy'
import type { SafeIntelligenceSourceDetailView } from '../../../service/intelligence/schema/intelligenceSourcesContracts'
import type { SourceRunOutcome } from './intelligenceSourceProfileEditor'
import {
  computeSourceHealthDetail,
  type SourceHealthIdleReason,
  type SourceRunNowAnswer
} from './sourceHealthCells'

/**
 * 标签旁那颗 ⓘ 的读屏名。是**名字**、不继承字段名：读屏会念两遍同一个词（同 `settingsInfo` 那条规矩）。
 * 句子走 `resolveText`，这里只留键。
 */
const UNKNOWN_REASON_ARIA_KEY = 'settings.intelligenceSources.health.unknownReasonAria'
const AUTOMATIC_SYNC_STOPPED_ARIA_KEY = 'settings.intelligenceSources.health.automaticSyncStoppedAria'

/**
 * 一个源的详情读取状态。
 *
 * `skipped` 是**日历 feed**：它只在日历的注册表里，通用源服务没有它的详情——问一次只会得到
 * 「未知来源」。所以这里不读、也不把它画成「读失败」或「没有数据」，四格里读不到的那两格写
 * 「未知」，**原因句进那一格标签旁的 ⓘ**（「没有」与「拿不到」是两件事，但都留在格子里说）。
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
  /** 「刚跑完，读数还没刷新」：四格保留旧值时的状态句（不是「没有数据」）。 */
  refreshStale: string
  reasons: Readonly<Record<SourceHealthIdleReason, string>>
  runNow: Readonly<Record<SourceRunNowAnswer, string>>
  /** B5 立即运行的三态文案（可运行 / 正在运行 / 跑完自动恢复）。 */
  runAction: Readonly<{ run: string; running: string; runningInfo: string; runningInfoAria: string; failedToStart: string }>
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
  /** 只有「能立刻采」的源会拿到这颗按钮；没有这个监听（例如只读嵌入）就不画按钮，只给答案。 */
  onRunNow?: (sourceId: string) => Promise<SourceRunOutcome>
  resolveText: (key: string) => string
  /** 不可用源的整组说明里那一句（「自动同步已停止」）；与原因句串在同一格。 */
  automaticSyncStopped: string
  /** 刚跑完、后台刷新没成功：四格保留旧值，旁边补一句状态。 */
  refreshStale?: boolean
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

  /**
   * 说明句只在标签旁的 ⓘ 里（用户 2026-11-10：声明性文字不要直接显示在界面上）。
   * 值本身仍是状态词（「未知」/ 不可用那句读者说法），原因句跟着**它自己那一格**，不攒成一行。
   */
  const unknownInfo = <HealthInfo
    ariaLabelKey={UNKNOWN_REASON_ARIA_KEY}
    resolveText={props.resolveText}
    sentence={labels.unknownReason} />

  return <div className="source-provider-detail__health" data-source-health={source.sourceId} data-health-read={read.state}>
    <div className="intelligence-health-list">
      <HealthCell
        cell="today"
        info={view.today.kind === 'unknown' ? unknownInfo : undefined}
        label={labels.todayReading}
        unknown={view.today.kind === 'unknown'}>{todayValue}</HealthCell>
      <HealthCell
        cell="last-success"
        info={view.lastSuccess.kind === 'unknown' ? unknownInfo : undefined}
        label={labels.lastSuccessAt}
        unknown={view.lastSuccess.kind === 'unknown'}>{lastSuccessValue}</HealthCell>
      <HealthCell
        cell="idle-reason"
        info={view.idleReason === 'unavailable'
          ? <HealthInfo
            ariaLabelKey={AUTOMATIC_SYNC_STOPPED_ARIA_KEY}
            resolveText={props.resolveText}
            sentence={props.automaticSyncStopped} />
          : undefined}
        label={labels.whyNotCollecting}>
        {view.idleReason === 'unavailable'
          ? <UnavailableReason
            kind={source.kind}
            reasonCode={view.unavailableReasonCode}
            resolveText={props.resolveText} />
          : labels.reasons[view.idleReason]}
      </HealthCell>
      <HealthCell cell="run-now" interactive label={labels.runNowAnswer}>
        {view.runNow === 'yes' && props.onRunNow !== undefined
          ? <RunNowControl
            labels={labels.runAction}
            onRun={() => props.onRunNow!(source.sourceId)}
            resolveText={props.resolveText}
            sourceId={source.sourceId} />
          : labels.runNow[view.runNow]}
      </HealthCell>
    </div>
    {/* 跑完但读数没刷新：四格还是旧的，必须说出来——否则「跑完了」会把旧读数读成刚采到的。
        这句是**状态**（`role="status"`，读屏唯一的通知通道），不是解释，所以留在正文。 */}
    {props.refreshStale === true
      ? <p className="intelligence-source-note intelligence-source-note--health" role="status">{labels.refreshStale}</p>
      : null}
  </div>
}

/** 标签旁那颗 ⓘ：说明句住在这里，正文只留字段名与状态词（同这一屏既有的两颗）。 */
function HealthInfo(props: {
  ariaLabelKey: string
  sentence: string
  resolveText: (key: string) => string
}): React.ReactElement {
  return <Popover
    content={<span>{props.sentence}</span>}
    trigger={(triggerProps) => (
      <IconButton
        {...triggerProps}
        ariaLabelKey={props.ariaLabelKey}
        icon={Info}
        resolveText={props.resolveText}
        size="sm"
        variant="plain" />
    )} />
}

function HealthCell(props: {
  cell: 'today' | 'last-success' | 'idle-reason' | 'run-now'
  label: string
  unknown?: boolean
  /** 值里放控件（立即运行那颗按钮）时不能用 `<strong>` 包一个可交互元素。 */
  interactive?: boolean
  /** 标签旁的 ⓘ（可选）：有它才加 `--with-info` 那档排布，没有的字宽不变。 */
  info?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  const valueProps = { className: 'intelligence-health-value', ...(props.unknown === true ? { 'data-unknown': 'true' } : {}) }
  return <div className="intelligence-health-item" data-health-cell={props.cell}>
    <span className={props.info === undefined ? 'intelligence-health-label' : 'intelligence-health-label intelligence-health-label--with-info'}>
      {props.label}
      {props.info}
    </span>
    {props.interactive === true ? <div {...valueProps}>{props.children}</div> : <strong {...valueProps}>{props.children}</strong>}
  </div>
}

/** 不可用原因：格内只放读者说法这一句（不超过两行），码只进 ⓘ、恰一处。映射表全仓一份（shared）。 */
function UnavailableReason(props: {
  reasonCode?: string
  resolveText: (key: string) => string
  kind: string
}): React.ReactElement {
  const reasonCode = props.reasonCode
  // 表里没有的码退回「取不到（原因见详情）」，永远不抛错；也不从码里截数字（码名一改，403 就变了）。
  // 兜底句与抽屉**同一个文案键**，不是两句长得像的话。
  const sentence = sourceUnavailableSentence(reasonCode, props.resolveText(SOURCE_UNAVAILABLE_FALLBACK_KEY), props.kind)
  return <>
    <span>{sentence}</span>
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

/**
 * B5：设置页的「立即运行」。只在**平台声明可运行、且这个源当前可用**时出现（那条判据在
 * `sourceHealthCells` 一处算，四格的第四格与这颗按钮读同一个答案）。
 *
 * 三态按 2026-11-06 的原型：可运行 / 正在运行（禁用，同一行 `role="status"` 说「跑完会自动恢复」）/
 * 跑完（成功带摘要、没成带原因）。禁用按钮不进 Tab、读屏也读不到，所以那句状态必须有。
 */
function RunNowControl(props: {
  labels: SourceHealthLabels['runAction']
  onRun: () => Promise<SourceRunOutcome>
  resolveText: (key: string) => string
  sourceId: string
}): React.ReactElement {
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<SourceRunOutcome>()

  async function run(): Promise<void> {
    setRunning(true)
    setOutcome(undefined)
    try {
      setOutcome(await props.onRun())
    } catch {
      // 运行入口自己会把握手失败翻成人话；万一它抛了，也只能说「没成」，不许静默。
      setOutcome({ kind: 'failed', notice: props.labels.failedToStart })
    } finally {
      setRunning(false)
    }
  }

  return <div className="source-provider-detail__run" data-run-source={props.sourceId} data-run-state={running ? 'running' : outcome?.kind ?? 'idle'}>
    <Button disabled={running} loading={running} onClick={() => void run()} size="small">
      {running ? props.labels.running : props.labels.run}
    </Button>
    {/* 正文只留状态词；「跑完会自动恢复」是说明，进旁边的 ⓘ（禁用按钮不进 Tab，读屏靠这条 status）。 */}
    <Popover
      content={<span>{props.labels.runningInfo}</span>}
      trigger={(triggerProps) => (
        <IconButton
          {...triggerProps}
          ariaLabelKey="settings.intelligenceSources.health.runAction.infoAria"
          icon={Info}
          resolveText={props.resolveText}
          size="sm"
          variant="plain" />
      )} />
    <span className="source-provider-detail__run-status" role="status">
      {running ? props.labels.running : outcome?.notice ?? ''}
    </span>
  </div>
}
