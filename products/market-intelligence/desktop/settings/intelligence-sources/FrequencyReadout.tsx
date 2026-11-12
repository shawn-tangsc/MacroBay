import type { ReactElement } from 'react'

import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellClock } from '@platform/ui/time/shellTimeFormat'

import type { FrequencyReadoutView } from './sourceCadence'

import './frequencyReadout.css'

const POLICY = 'settings.intelligenceSources.collectionPolicy'

/**
 * 频率行下拉下方那一行读数（原型 2026-11-13 定死）：`间隔 15 分钟 · 下次 14:30`。
 *
 * 硬判据：
 * - **两段独立**：间隔读到了就画间隔；第二段各自说自己的事，一段不可判定不影响另一段；
 * - **读不到 ≠ 0 ≠ 从未**：不写 `--`、不写 `0`、不写「从未采集」；
 * - 手动档不写占位线，写「手动：不自动采集」；
 * - 时刻走平台统一格式化（读者时区）；跨天由 `formatShellClock` 自己带上 `月-日`，
 *   这里不拼日期、也不自己算时区。
 */
export function FrequencyReadout(props: Readonly<{
  view: FrequencyReadoutView
  resolveText: (key: string) => string
}>): ReactElement | null {
  const timeZone = useShellTimeZone()
  const { view, resolveText } = props
  // 整批投影读不到：这一行不画占位（原因进同一颗 ⓘ），别让读者以为「间隔是 0」。
  if (view.kind === 'unreadable') return null
  if (view.kind === 'disabled') return <span className="business-card__preset-readout" data-frequency-readout="disabled">
    {resolveText(`${POLICY}.disabledNoCollect`)}
  </span>
  if (view.kind === 'manual') return <span className="business-card__preset-readout" data-frequency-readout="manual">
    {resolveText(`${POLICY}.manualOnly`)}
  </span>
  if (view.kind === 'unscheduled') return <span className="business-card__preset-readout" data-frequency-readout="unscheduled">
    {resolveText(`${POLICY}.unscheduled`)}
  </span>

  const interval = formatInterval(view.intervalSeconds, resolveText)
  const next = formatNext(view.next, resolveText, timeZone)
  return <span className="business-card__preset-readout" data-frequency-readout={`interval-${view.next.kind}`}>
    <span>{interval}</span>
    {next === null ? null : <>
      <span aria-hidden="true" className="business-card__preset-readout-sep">·</span>
      <span>{next}</span>
    </>}
  </span>
}

function formatInterval(seconds: number, resolveText: (key: string) => string): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  const wholeHours = minutes >= 60 && minutes % 60 === 0
  const template = resolveText(`${POLICY}.${wholeHours ? 'intervalHours' : 'intervalMinutes'}`)
  return fillLabelParams(template, { count: String(wholeHours ? minutes / 60 : minutes) })
}

function formatNext(
  next: Extract<FrequencyReadoutView, { kind: 'interval' }>['next'],
  resolveText: (key: string) => string,
  timeZone: string
): string | null {
  if (next.kind === 'running') return resolveText(`${POLICY}.nextRunning`)
  if (next.kind === 'notStarted') return resolveText(`${POLICY}.nextNotStarted`)
  if (next.kind === 'unreadable') return resolveText(`${POLICY}.nextUnreadable`)
  const clock = formatShellClock(next.instant, { timeZone })
  // 格式器读不出来这个时刻：**这一半**归「读不到」，不拿原串顶上、也不写 `--`。
  if (clock === null) return resolveText(`${POLICY}.nextUnreadable`)
  return fillLabelParams(resolveText(`${POLICY}.nextAt`), { time: clock })
}
