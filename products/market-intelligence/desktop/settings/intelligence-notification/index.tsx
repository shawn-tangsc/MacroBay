import { Info } from 'lucide-react'
import { Switch } from 'antd'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { intelligenceNotificationText } from './text'
import {
  INTELLIGENCE_CHANNEL_EVENT_ROWS,
  useChannelEventSettings,
  type IntelligenceChannelEventRow
} from './useChannelEventSettings'

import './intelligence-notification.css'

/**
 * 设置 → 情报 → 通知（界面规范 v2.27 §9d）。
 *
 * 只有三条：模块信号、宏观事件、日报完成，**默认全开**。这一屏只管「推不推手机」；
 * 应用内提示与桌面提醒在通用通知页，不搬到这里、也不在这里重复。
 *
 * 频道没就绪时**不禁用**：勾选照常存，块头一行说明它会在频道可用后生效——
 * 禁用会让读者以为这条设置坏了，而实际上选择是有效的。
 */
export default function IntelligenceNotificationSettingsSection(): React.ReactElement {
  const language = useShellLanguage()
  const text = intelligenceNotificationText[language]
  const resolveText = (key: string): string => text[key] ?? ''
  const { status, values, savingEventId, failedEventId, channelReady, reload, toggle } =
    useChannelEventSettings()

  if (status === 'loading') {
    return (
      <section className="settings-workspace intelligence-notification-workspace" aria-busy="true">
        <LoadingState ariaLabel={text['pages.intelligence.notification.groupTitle']} />
      </section>
    )
  }

  // 读不到就报读不到，并给「再试一次」：渲染成空清单会让读者以为三条都被关掉了。
  if (status === 'error') {
    return (
      <section className="settings-workspace intelligence-notification-workspace">
        <StateView
          state="error"
          reasonCode="unreadable"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: reload }}
        />
      </section>
    )
  }

  return (
    <section className="settings-workspace intelligence-notification-workspace">
      <div className="intelligence-notification-card">
        <header className="intelligence-notification-heading">
          <h2 className="intelligence-notification-title">{text['pages.intelligence.notification.groupTitle']}</h2>
          <Popover
            lines={[{ labelKey: 'pages.intelligence.notification.groupInfo.1' }, { labelKey: 'pages.intelligence.notification.groupInfo.2' }]}
            resolveText={resolveText}
            trigger={(triggerProps) => (
              <IconButton
                {...triggerProps}
                ariaLabelKey="pages.intelligence.notification.infoAria"
                icon={Info}
                size="sm"
                variant="plain"
                resolveText={resolveText}
              />
            )}
          />
        </header>

        {channelReady ? null : (
          <p className="intelligence-notification-hint" role="status">
            {text['pages.intelligence.notification.channelNotReady']}
          </p>
        )}

        <ul className="intelligence-notification-rows">
          {INTELLIGENCE_CHANNEL_EVENT_ROWS.map((row) => (
            <ChannelEventRow
              key={row.eventId}
              row={row}
              text={text}
              resolveText={resolveText}
              enabled={values[row.eventId] ?? true}
              saving={savingEventId === row.eventId}
              saveFailed={failedEventId === row.eventId}
              onChange={(next) => toggle(row.eventId, next)}
            />
          ))}
        </ul>

        <p className="intelligence-notification-footer">{text['pages.intelligence.notification.footer']}</p>
      </div>
    </section>
  )
}

function ChannelEventRow(props: {
  row: IntelligenceChannelEventRow
  text: Readonly<Record<string, string>>
  resolveText: (key: string) => string
  enabled: boolean
  saving: boolean
  saveFailed: boolean
  onChange: (enabled: boolean) => void
}): React.ReactElement {
  const title = props.text[props.row.titleKey] ?? ''
  return (
    <li className="intelligence-notification-row">
      <div className="intelligence-notification-row-label">
        <span className="intelligence-notification-row-title">{title}</span>
        <Popover
          labelKey={props.row.infoKey}
          resolveText={props.resolveText}
          trigger={(triggerProps) => (
            <IconButton
              {...triggerProps}
              ariaLabelKey="pages.intelligence.notification.rowInfoAria"
              icon={Info}
              size="sm"
              variant="plain"
              resolveText={props.resolveText}
            />
          )}
        />
      </div>
      <Switch
        checked={props.enabled}
        loading={props.saving}
        disabled={props.saving}
        aria-label={title}
        onChange={props.onChange}
      />
      {props.saveFailed ? (
        <p className="intelligence-notification-save-failed" role="alert">
          {props.text['pages.intelligence.notification.saveFailed']}
        </p>
      ) : null}
    </li>
  )
}
