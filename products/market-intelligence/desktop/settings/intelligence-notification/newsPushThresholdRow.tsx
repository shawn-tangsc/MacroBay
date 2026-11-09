import type { ReactElement } from 'react'

import { Segmented } from '@platform/ui/components/segmented'

import type { NewsSentimentTierThreshold } from '../../../contracts/newsSentimentTiers'
import { SettingsRow } from './settingsRow'
import type { NewsPushThresholdRowState } from './useNewsPushThreshold'
import { NEWS_PUSH_THRESHOLD_KEYS } from './notificationKeys'

/**
 * 「舆情提醒」详情里的一行：**最低强度**（高 / 中 / 低，默认中；选哪档就是该档及以上都推）。
 *
 * 屏上的词是「最低强度」，不是「强度门槛 / 弱中强」——**这是最低强度，不是推送强度分档**：
 * 选「低」只表示更多条能进来，不是把每条推送的强度调低。
 *
 * 一行一件事：标签在左（160 列）、分段控件在控件列左缘对齐。**说明只在 ⓘ 里**（用户 2026-11-08
 * 第三次定：正文只留字段名、当前值、控件）；档位代价那句跟着进 ⓘ，不再随选「低」冒出来。
 * 档位语义不在这里定义——`tierOf` / `meetsTierThreshold` 是唯一实现，这里只画读者选的档。
 */
export function NewsPushThresholdRow(props: Readonly<{
  state: NewsPushThresholdRowState
  text: Readonly<Record<string, string>>
  resolveText: (key: string) => string
  last?: boolean
}>): ReactElement {
  const label = props.text['pages.intelligence.notification.threshold.row'] ?? ''
  return <SettingsRow
    info={{
      ariaLabelKey: 'pages.intelligence.notification.threshold.aria',
      labelKeys: [
        'pages.intelligence.notification.threshold.info',
        'pages.intelligence.notification.threshold.cost'
      ],
      resolveText: props.resolveText
    }}
    label={label}
    last={props.last}
  >
    {/* 读不到时**不画档位**：把默认值「中」画成已配置，等于用「拿不到」冒充「他设的」。
        同时说明现在按哪一档在推（fail-open，但必须说出来）。 */}
    {props.state.status === 'error'
      ? <>
        <span className="intelligence-notification-form-note" role="status">
          {props.text['pages.intelligence.notification.threshold.unreadable']}
        </span>
        <span className="intelligence-notification-form-note" role="status">
          {props.text['pages.intelligence.notification.threshold.unreadableNote']}
        </span>
      </>
      : <Segmented
        ariaLabelKey="pages.intelligence.notification.threshold.row"
        items={(['high', 'medium', 'low'] as const).map((tier) => ({
          value: tier,
          labelKey: NEWS_PUSH_THRESHOLD_KEYS[tier]
        }))}
        onChange={(next) => props.state.setThreshold(next as NewsSentimentTierThreshold)}
        resolveText={props.resolveText}
        value={props.state.value}
      />}
    {/* 存不上是**状态**，不是说明：它只在出事时出现，必须当场看见。 */}
    {props.state.saveFailed
      ? <span className="intelligence-notification-form-note" role="status">
        {props.text['pages.intelligence.notification.saveFailed']}
      </span>
      : null}
  </SettingsRow>
}
