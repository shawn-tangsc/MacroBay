import type { ReactElement, ReactNode } from 'react'

import { helpTrigger } from '@platform/ui/components/popover'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'

import type { PlatformText } from '../../i18n/platformText'

import './deliveryRow.css'

/**
 * 「送达」组里的一行（#46）：「文字」「海报」共用一个形态。
 *
 * 一行一条事实：`dt` 标签两字、`dd` 值一行 `nowrap`。状态词走平台 `StatusPill`（四态四形状，
 * 灰度下也分得开）；数字**不进药丸**（它只收键），紧跟其后；原因短词与数字是两种字号，
 * 所以它们是两个节点、中间那个「·」是**文案键**给的（`value.separator`），不是 CSS 的 `content:`
 * ——可见文案零字面量，标点也算。
 *
 * ⓘ 只在有话说时出现，用平台 `helpTrigger`：读屏名同一句「查看说明」，浮层能力归组件。
 */
export function DeliveryRow(props: Readonly<{
  label: string
  state: DeliveryRowState
  counts?: string
  reason?: string
  hints: readonly string[]
  /** 「送达」组那一层文案：三个共用状态词在 `state`，`noImage` 与分隔点在 `poster` 下。 */
  detail: PlatformText['notifications']['detail']
}>): ReactElement {
  const labelKey = STATE_KEY[props.state]
  const label = props.state === 'noImage' ? props.detail.poster.state.noImage : props.detail.state[props.state]
  return (
    <div className="notification-delivery-row" data-delivery-state={props.state}>
      <dt>{props.label}</dt>
      <dd>
        <StatusPill
          tone={STATE_TONE[props.state]}
          labelKey={labelKey}
          // 状态词来自壳的文案表；组件之间也只传键，解析器把这一条映射成句子。
          resolveText={(key) => (key === labelKey ? label : key)}
        />
        {props.counts === undefined ? null : (
          <span className="notification-delivery-row__counts">{props.counts}</span>
        )}
        {props.reason === undefined ? null : (
          <>
            <span className="notification-delivery-row__separator">{props.detail.poster.value.separator}</span>
            <span className="notification-delivery-row__reason">{props.reason}</span>
          </>
        )}
        {props.hints.length === 0
          ? null
          : <span className="notification-delivery-row__hint">{helpTrigger({ lines: props.hints }) as ReactNode}</span>}
      </dd>
    </div>
  )
}

export type DeliveryRowState = 'sent' | 'unconfirmed' | 'failed' | 'noImage'

/** 四态 → 药丸档位。点形状由 `StatusPill` 按档位给（圆 / 环 / 方 / 小点），这里不重复一套。 */
const STATE_TONE: Record<DeliveryRowState, StatusPillTone> = {
  sent: 'ok',
  unconfirmed: 'warn',
  failed: 'bad',
  noImage: 'muted'
}

/**
 * 状态词的键。三个共用词在 `notifications.detail.state.*`（「文字」「海报」两行同一个词），
 * `noImage` 只属于海报那一行，留在 `poster.state` 下——挂在海报名下的共用词会让改海报措辞时
 * 悄悄改掉文字行。
 */
const STATE_KEY: Record<DeliveryRowState, string> = {
  sent: 'notifications.detail.state.sent',
  unconfirmed: 'notifications.detail.state.unconfirmed',
  failed: 'notifications.detail.state.failed',
  noImage: 'notifications.detail.poster.state.noImage'
}
