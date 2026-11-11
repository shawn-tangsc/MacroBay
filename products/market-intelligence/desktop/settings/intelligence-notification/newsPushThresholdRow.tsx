import type { ReactElement } from 'react'

import { Segmented } from '@platform/ui/components/segmented'

import type { NewsSentimentTierThreshold } from '../../../contracts/newsSentimentTiers'
import type { SettingDescriptor } from '../../shared/settings/descriptorTypes'
import { settingRegistry } from '../../shared/settings/registry'
import { SettingField } from '../../shared/settings/SettingField'
import { SettingsRow } from './settingsRow'
import type { NewsPushThresholdRowState } from './useNewsPushThreshold'
import { NEWS_PUSH_THRESHOLD_KEYS } from './notificationKeys'

const ROW_CLASS = 'intelligence-notification-form-row'
const LABEL_CLASS = 'intelligence-notification-form-label'
const LABEL_TEXT_CLASS = 'intelligence-notification-form-label-text'
const CONTROL_CLASS = 'intelligence-notification-form-control'

/**
 * 这一项被自己的开关挡住时那句话。它是**说明**，不是状态句：只在关着时成立，所以按状态追加到
 * ⓘ 里（用户口径：正文只留字段名、当前值、控件），不删这句——读者需要知道去哪儿开。
 */
const THRESHOLD_DISABLED_NOTE_KEY = 'pages.intelligence.notification.threshold.disabledNote'

function thresholdDescriptor(): SettingDescriptor {
  const descriptor = settingRegistry.notifications.find((row) => row.key === 'setting:notifications.push-threshold')
  if (!descriptor) throw new Error('missing setting descriptor: setting:notifications.push-threshold')
  return descriptor
}

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
  /**
   * 这一项自己的开关关着：控件灰着、点了不写，并就地说明「先打开舆情提醒」。
   * 关着也要看得见这一行（用户 2026-11-11：撤平台页是换位置，不是减功能）。
   */
  disabled?: boolean
}>): ReactElement {
  const label = props.text['pages.intelligence.notification.threshold.row'] ?? ''
  const failed = props.state.saveFailed
    ? <span className="intelligence-notification-form-note" role="status">
      {props.text['pages.intelligence.notification.saveFailed']}
    </span>
    : null

  // 读不到时**不画档位**：把默认值「中」画成已配置，等于用「拿不到」冒充「他设的」。
  // 这一态保留原样（它就是状态行，不是设置控件），正常态才由声明渲染。
  if (props.state.status === 'error') {
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
      <span className="intelligence-notification-form-note" role="status">
        {props.text['pages.intelligence.notification.threshold.unreadable']}
      </span>
      <span className="intelligence-notification-form-note" role="status">
        {props.text['pages.intelligence.notification.threshold.unreadableNote']}
      </span>
      {failed}
    </SettingsRow>
  }

  return <SettingField
    busy={props.state.saving}
    controlWrapperClassName={CONTROL_CLASS}
    copyClassName={LABEL_CLASS}
    descriptor={thresholdDescriptor()}
    disabled={props.disabled === true}
    extraHelpKeys={props.disabled === true ? [THRESHOLD_DISABLED_NOTE_KEY] : undefined}
    labelTextClassName={LABEL_TEXT_CLASS}
    onChange={(next) => props.state.setThreshold(next as NewsSentimentTierThreshold)}
    resolveOptionLabel={(option) =>
      props.text[NEWS_PUSH_THRESHOLD_KEYS[option as NewsSentimentTierThreshold]] ?? String(option)}
    resolveText={props.resolveText}
    rowClassName={`${ROW_CLASS}${props.last === true ? ' is-last' : ''}`}
    value={props.state.value}
    view={{}}
  >
    {/* 存不上是**状态**，不是说明：它只在出事时出现，必须当场看见。 */}
    {failed}
  </SettingField>
}
