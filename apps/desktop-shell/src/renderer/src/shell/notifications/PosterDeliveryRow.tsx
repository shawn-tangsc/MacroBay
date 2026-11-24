import type { ReactElement, ReactNode } from 'react'

import type { NotificationPosterEvidence } from '@platform/notifications/contracts/notificationPosterContracts'
import { helpTrigger } from '@platform/ui/components/popover'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'

import type { PosterRowState, PosterRowTexts } from './posterRowModel'
import { posterRowModel } from './posterRowModel'

import './posterDeliveryRow.css'

/**
 * 通知详情「送达」组里的「海报」这一行（#46）。
 *
 * 结构跟着同组的「文字」行：一行一条事实，`dt` 标签两字（海报）、`dd` 值一行 `nowrap`。
 * 它**紧跟在「文字」后面**（同一次推送的两条消息必须挨着），没有推送对象时整行不出现——
 * 这两种位置关系由宿主保证，组件只画这一行。
 *
 * 状态词走平台 `StatusPill`（四态四形状，灰度下也分得开）；数字**不进药丸**（它只收键），
 * 紧跟其后：「已发送」+「2 条通道」。原因短词与数字是两种字号（数字弱化、原因是正文色），
 * 所以它们是两个节点，而不是拼成一句——扫描顺序是「状态 → 数字 → 为什么」。
 *
 * ⓘ 只在有话说时出现（≥2 条通道失败且原因不同 / 有不支持图片的通道），用平台 `helpTrigger`：
 * 读屏名是同一句「查看说明」，浮层的能力（悬停/聚焦开、点击钉住、Esc 关并回焦）都归组件。
 */
export function PosterDeliveryRow(props: Readonly<{
  poster?: NotificationPosterEvidence
  text: PosterRowTexts
}>): ReactElement | null {
  const model = posterRowModel(props.poster, props.text)
  if (model === null) return null

  const labelKey = STATE_KEY[model.state]
  const label = props.text.state[model.state]

  return (
    <div className="notification-poster-row" data-poster-state={model.state}>
      <dt>{props.text.label}</dt>
      <dd>
        <StatusPill
          tone={STATE_TONE[model.state]}
          labelKey={labelKey}
          // 状态词来自壳的文案表；组件之间也只传键，解析器把这一条映射成句子。
          resolveText={(key) => (key === labelKey ? label : key)}
        />
        {model.counts === undefined ? null : (
          <span className="notification-poster-row__counts">{model.counts}</span>
        )}
        {model.reason === undefined ? null : (
          <span className="notification-poster-row__reason">{model.reason}</span>
        )}
        {model.hints.length === 0 ? null : <span className="notification-poster-row__hint">{helpTrigger({ lines: model.hints }) as ReactNode}</span>}
      </dd>
    </div>
  )
}

/** 四态 → 药丸档位。点形状由 `StatusPill` 按档位给（圆 / 环 / 方 / 小点），这里不重复一套。 */
const STATE_TONE: Record<PosterRowState, StatusPillTone> = {
  sent: 'ok',
  unconfirmed: 'warn',
  failed: 'bad',
  noImage: 'muted'
}

/** 状态词的键（写全路径，文案表里就是这三段）。 */
const STATE_KEY: Record<PosterRowState, string> = {
  sent: 'notifications.detail.poster.state.sent',
  unconfirmed: 'notifications.detail.poster.state.unconfirmed',
  failed: 'notifications.detail.poster.state.failed',
  noImage: 'notifications.detail.poster.state.noImage'
}