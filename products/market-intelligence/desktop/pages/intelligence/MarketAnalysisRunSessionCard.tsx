import { useEffect, useState } from 'react'
import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'

import {
  loadMarketAnalysisRunOutcome,
  type MarketAnalysisRunOutcome,
  type MarketAnalysisRunOutcomeLoad,
  type MarketAnalysisRunStatus
} from '../../shared/ipc/marketAnalysisRunOutcome'
import type { MarketAnalysisRunSessionText } from './marketAnalysisRunSessionText'

const INFO_KEY = 'marketAnalysisRunSession.info'

/** 状态 → 药丸档位。只有这八档，映射也写死在这张表里。 */
const STATUS_TONE: Readonly<Record<MarketAnalysisRunStatus, StatusPillTone>> = {
  queued: 'muted',
  running: 'info',
  succeeded: 'ok',
  'invalid-output': 'bad',
  failed: 'bad',
  cancelled: 'muted',
  stale: 'warn',
  superseded: 'muted'
}

type LoadState = Readonly<{ state: 'loading' }> | MarketAnalysisRunOutcomeLoad

/**
 * 自动会话里的「这次运行」。
 *
 * 每条自动会话是一次运行；运行会在会话里留下卡片，但**失败的运行不写正文**（摘要只在发布时追加）。
 * 于是读者点开只有一张卡片、下面全空——这张卡片补的就是那件事：这次运行是什么状态、为什么没有正文、
 * 什么时候跑的。
 *
 * 三种结果分开，不许合并：
 * - 读到了 → 状态 + 原因 + 起止时刻（失败是事实，照实说）；
 * - 记录不存在 → 「没有留下记录」（事实，不是错误）；
 * - 读失败 → 错误态 + 重试（不是空白，也不是「没有」）。
 */
export function MarketAnalysisRunSessionCard({
  runId,
  text,
  failureReasons,
  loadRun = loadMarketAnalysisRunOutcome
}: Readonly<{
  runId: string | null
  text: MarketAnalysisRunSessionText
  /** 运行失败码 → 读者说法。复用时间轴那张表，不在卡片里另抄一套。 */
  failureReasons: Readonly<Record<string, string>>
  /** 测试注入点；默认走产品 IPC。 */
  loadRun?: (runId: string) => Promise<MarketAnalysisRunOutcomeLoad>
}>): React.ReactElement {
  const timeZone = useShellTimeZone()
  const [attempt, setAttempt] = useState(0)
  const [load, setLoad] = useState<LoadState>({ state: 'loading' })

  useEffect(() => {
    if (!runId) {
      setLoad({ state: 'no-record' })
      return
    }
    let active = true
    setLoad({ state: 'loading' })
    void loadRun(runId).then(
      (next) => { if (active) setLoad(next) },
      () => { if (active) setLoad({ state: 'unreadable' }) }
    )
    return () => { active = false }
  }, [runId, attempt, loadRun])

  const info = (
    <Popover
      lines={[{ labelKey: INFO_KEY }]}
      resolveText={(key) => (key === INFO_KEY ? text.info : key)}
      trigger={(triggerProps) => (
        <IconButton
          {...triggerProps}
          ariaLabelKey={INFO_KEY}
          icon={Info}
          resolveText={(key) => (key === INFO_KEY ? text.infoAria : key)}
          size="sm"
          variant="plain"
        />
      )}
    />
  )

  if (load.state === 'loading') {
    return (
      <section className="mi-agent-run-card" data-run-card="loading" aria-label={text.title}>
        <LoadingState layout="inline" size="sm" label={text.title} />
      </section>
    )
  }

  if (load.state === 'unreadable') {
    return (
      <section className="mi-agent-run-card" data-run-card="unreadable" aria-label={text.title}>
        <StateView
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => setAttempt((value) => value + 1) }}
          reasonCode="unreadable"
          size="sm"
          state="error"
        />
      </section>
    )
  }

  if (load.state === 'no-record') {
    return (
      <section className="mi-agent-run-card" data-run-card="no-record" aria-label={text.title}>
        <div className="mi-agent-run-card__head">
          <span className="mi-agent-run-card__fact">{text.noRecord}</span>
          {info}
        </div>
      </section>
    )
  }

  const run: MarketAnalysisRunOutcome = load.run
  const failed = run.status !== 'succeeded'
  const reason = run.failureCode === null ? null : failureReasons[run.failureCode]
  return (
    <section className="mi-agent-run-card" data-run-card="available" data-run-status={run.status} aria-label={text.title}>
      <div className="mi-agent-run-card__head">
        <StatusPill
          labelKey={run.status}
          resolveText={(key) => text.status[key as MarketAnalysisRunStatus] ?? key}
          tone={STATUS_TONE[run.status]}
        />
        <span className="mi-agent-run-card__times">
          {text.startedAt} {formatShellInstant(run.startedAt ?? run.queuedAt, { timeZone })}
          {' · '}
          {text.finishedAt} {run.completedAt === null ? '—' : formatShellInstant(run.completedAt, { timeZone })}
        </span>
        {info}
      </div>
      {failed ? (
        <>
          <span className="mi-agent-run-card__fact">{text.noBody}</span>
          <span className="mi-agent-run-card__reason">{reason ?? text.reasonUnknown}</span>
        </>
      ) : null}
    </section>
  )
}
