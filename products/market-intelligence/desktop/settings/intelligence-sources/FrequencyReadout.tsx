import type { ReactElement } from 'react'

import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellClock } from '@platform/ui/time/shellTimeFormat'

import type { FrequencyReadoutView } from './sourceCadence'

import './frequencyReadout.css'

const POLICY = 'settings.intelligenceSources.collectionPolicy'

/**
 * ⓘ 浮层第一行（只有这一条随状态变）：8 种状态各一条文案键，**不拼字符串**。
 *
 * 界面上这一行不再是正文：整条收进下拉旁边那颗 ⓘ（界面设计 2026-11-13 v4），
 * 所以验证路径从「看正文」变成「点开浮层」。间隔与时刻各用一次平台格式化器，
 * 再作为**已格式化好的字符串**填进模板——`fillLabelParams` 的约定。
 */
export type FrequencyReadoutLine = Readonly<{
  labelKey: string
  params?: Readonly<Record<string, string>>
}>

export function frequencyReadoutLine(
  view: FrequencyReadoutView,
  timeZone: string,
  resolveText: (key: string) => string
): FrequencyReadoutLine {
  if (view.kind === 'manual') return { labelKey: `${POLICY}.readoutManual` }
  if (view.kind === 'disabled') return { labelKey: `${POLICY}.readoutDisabled` }
  if (view.kind === 'unscheduled') return { labelKey: `${POLICY}.readoutUnscheduled` }
  // 整批排期读不到：第①条就是这一句——收进浮层不等于可以不显示。
  if (view.kind === 'unreadable') return { labelKey: `${POLICY}.readoutScheduleUnreadable` }

  const interval = formatInterval(view.intervalSeconds, resolveText)
  if (view.next.kind === 'running') {
    return { labelKey: `${POLICY}.readoutRunning`, params: { interval } }
  }
  if (view.next.kind === 'notStarted') {
    return { labelKey: `${POLICY}.readoutNotStarted`, params: { interval } }
  }
  if (view.next.kind === 'unreadable') {
    return { labelKey: `${POLICY}.readoutNextUnreadable`, params: { interval } }
  }
  const clock = formatShellClock(view.next.instant, { timeZone })
  // 时刻格式化不出来：这一条按「下次读不到」说，不拿原串顶上、也不写 `--`。
  if (clock === null) {
    return { labelKey: `${POLICY}.readoutNextUnreadable`, params: { interval } }
  }
  return { labelKey: `${POLICY}.readoutNextAt`, params: { interval, time: clock } }
}

/** 把 `frequencyReadoutLine` 解析成一句话（浮层的 `lines` 由 `Popover` 自己填参数）。 */
export function frequencyReadoutText(
  view: FrequencyReadoutView,
  timeZone: string,
  resolveText: (key: string) => string
): string {
  const line = frequencyReadoutLine(view, timeZone, resolveText)
  return fillLabelParams(resolveText(line.labelKey), line.params)
}

function formatInterval(seconds: number, resolveText: (key: string) => string): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  const wholeHours = minutes >= 60 && minutes % 60 === 0
  const template = resolveText(`${POLICY}.${wholeHours ? 'durationHours' : 'durationMinutes'}`)
  return fillLabelParams(template, { count: String(wholeHours ? minutes / 60 : minutes) })
}

/**
 * 「内置频率」那一行仍在正文里显示读数（那是产品自有节奏，不走浮层），
 * 排版只有一条：不截断、放不下就换行。
 */
export function FrequencyReadout(props: Readonly<{
  view: FrequencyReadoutView
  resolveText: (key: string) => string
}>): ReactElement | null {
  const timeZone = useShellTimeZone()
  const { view, resolveText } = props
  if (view.kind === 'unreadable') return null
  return <span className="business-card__preset-readout" data-frequency-readout={viewKind(view)}>
    {frequencyReadoutText(view, timeZone, resolveText)}
  </span>
}

function viewKind(view: FrequencyReadoutView): string {
  if (view.kind !== 'interval') return view.kind
  return `interval-${view.next.kind}`
}
