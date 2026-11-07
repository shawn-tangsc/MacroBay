import type { ReactElement } from 'react'

import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { Segmented } from '@platform/ui/components/segmented'

import type { NewsSentimentTierThreshold } from '../../../contracts/newsSentimentTiers'
import { SettingsRow } from './settingsRow'
import type { NewsPushThresholdRowState } from './useNewsPushThreshold'

/**
 * 「舆情提醒」详情里的一行：**强度门槛**（弱 / 中 / 强，选哪档就是该档以上都推）。
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
  return <SettingsRow
    label={label}
    last={props.last}
    {...(props.state.saveFailed
      ? { note: props.text['pages.intelligence.notification.saveFailed'] ?? '', noteRole: 'status' as const }
      : {})}
  >
    <Segmented
      ariaLabelKey="pages.intelligence.notification.threshold.row"
      items={(['low', 'medium', 'high'] as const).map((tier) => ({
        value: tier,
        labelKey: `pages.intelligence.notification.threshold.${tier}`
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
