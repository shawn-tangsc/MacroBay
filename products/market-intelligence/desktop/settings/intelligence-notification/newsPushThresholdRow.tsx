import type { ReactElement } from 'react'

import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
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
 * 一行一件事：标签在左（160 列）、分段控件在控件列左缘对齐、说明只在 ⓘ 里（正文不出现整句）。
 * 档位语义不在这里定义——`tierOf` / `meetsTierThreshold` 是唯一实现，这里只画读者选的档。
 */
export function NewsPushThresholdRow(props: Readonly<{
  state: NewsPushThresholdRowState
  text: Readonly<Record<string, string>>
  resolveText: (key: string) => string
  last?: boolean
}>): ReactElement {
  const label = props.text['pages.intelligence.notification.threshold.row'] ?? ''
  // 说明只放一行：**存不上比代价更急**，所以两者同时成立时先说存不上（代价那句在值没变回「低」时本来也不该出现）。
  const note = props.state.saveFailed
    ? props.text['pages.intelligence.notification.saveFailed'] ?? ''
    : props.state.value === 'low'
      ? props.text['pages.intelligence.notification.threshold.cost'] ?? ''
      : undefined
  return <SettingsRow
    label={label}
    last={props.last}
    {...(note === undefined || note === '' ? {} : { note, noteRole: 'status' as const })}
  >
    <Segmented
      ariaLabelKey="pages.intelligence.notification.threshold.row"
      items={(['high', 'medium', 'low'] as const).map((tier) => ({
        value: tier,
        labelKey: NEWS_PUSH_THRESHOLD_KEYS[tier]
      }))}
      onChange={(next) => props.state.setThreshold(next as NewsSentimentTierThreshold)}
      resolveText={props.resolveText}
      value={props.state.value}
    />
    <Popover
      labelKey="pages.intelligence.notification.threshold.info"
      resolveText={props.resolveText}
      trigger={(triggerProps) => (
        <IconButton
          {...triggerProps}
          ariaLabelKey="pages.intelligence.notification.threshold.aria"
          icon={Info}
          resolveText={props.resolveText}
          size="sm"
          variant="plain"
        />
      )}
    />
  </SettingsRow>
}
