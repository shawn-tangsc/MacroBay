import type { ReactElement } from 'react'

import type { NotificationPosterEvidence } from '@platform/notifications/contracts/notificationPosterContracts'

import { DeliveryRow } from './DeliveryRow'
import type { PosterRowTexts } from './posterRowModel'
import { posterRowModel } from './posterRowModel'

/**
 * 通知详情「送达」组里的「海报」这一行（#46）。
 *
 * 只负责把「推送那一刻冻结的事实」变成一行：四态、分母、计数与 ⓘ 的出现条件都在
 * `posterRowModel` 里（纯函数、可单独跑用例）；渲染形态与「文字」行共用 `DeliveryRow`。
 *
 * 它紧跟「文字」但不自己决定位置，也不在缺事实时画占位——`poster` 缺席（没有推送对象 /
 * 老记录没有这份事实 / 这次启用着的支持图片通道为 0）时整行不出现。
 */
export function PosterDeliveryRow(props: Readonly<{
  poster?: NotificationPosterEvidence
  text: PosterRowTexts
}>): ReactElement | null {
  const model = posterRowModel(props.poster, props.text)
  if (model === null) return null
  return (
    <DeliveryRow
      label={props.text.label}
      state={model.state}
      {...(model.counts === undefined ? {} : { counts: model.counts })}
      {...(model.reason === undefined ? {} : { reason: model.reason })}
      hints={model.hints}
      text={props.text}
    />
  )
}
