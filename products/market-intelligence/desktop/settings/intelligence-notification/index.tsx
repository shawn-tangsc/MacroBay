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
  useChannelEventSettings
} from './useChannelEventSettings'
import { useNewsPushOutletSwitch } from './useNewsPushOutletSwitch'

import './intelligence-notification.css'

/**
 * 设置 → 情报 → 通知（界面规范 v2.27 §9d）。
 *
 * 四条：模块信号、宏观事件、日报完成（**默认全开**）与舆情提醒（**默认关**）。这一屏只管
 * 「推不推手机」；应用内提示与桌面提醒在通用通知页，不搬到这里、也不在这里重复。
 *
 * 第四条与前三条的来源不同：前三条是**事件级开关**，第四条是**推送出口开关**（水位 + 基线），
 * 所以它自己读自己写，但长得和另外三条一样——读者不需要知道背后的区别。
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
  const outlet = useNewsPushOutletSwitch()

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
              titleKey={row.titleKey}
              infoKey={row.infoKey}
              text={text}
              resolveText={resolveText}
              enabled={values[row.eventId] ?? true}
              saving={savingEventId === row.eventId}
              saveFailed={failedEventId === row.eventId}
              onChange={(next) => toggle(row.eventId, next)}
            />
          ))}
          {/* 第四条：值只从服务读，写完读回；读不到时不假装关着，而是就地说明读不到。 */}
          {outlet.status === 'error'
            ? <li className="intelligence-notification-row">
              <span className="intelligence-notification-row-title">
                {text['pages.intelligence.notification.rows.sentimentAlert.title']}
              </span>
              <span className="intelligence-notification-save-failed" role="status">
                {text['pages.intelligence.notification.outletUnreadable']}
              </span>
            </li>
            : <ChannelEventRow
              titleKey="pages.intelligence.notification.rows.sentimentAlert.title"
              infoKey="pages.intelligence.notification.rows.sentimentAlert.info"
              text={text}
              resolveText={resolveText}
              enabled={outlet.enabled}
              saving={outlet.saving || outlet.status === 'loading'}
              saveFailed={outlet.saveFailed}
              onChange={outlet.setEnabled}
            />}
        </ul>

        <p className="intelligence-notification-footer">{text['pages.intelligence.notification.footer']}</p>
      </div>
    </section>
  )
}

function ChannelEventRow(props: {
  titleKey: string
  infoKey: string
  text: Readonly<Record<string, string>>
  resolveText: (key: string) => string
  enabled: boolean
  saving: boolean
  saveFailed: boolean
  onChange: (enabled: boolean) => void
}): React.ReactElement {
  const title = props.text[props.titleKey] ?? ''
  return (
    <li className="intelligence-notification-row">
      <div className="intelligence-notification-row-label">
        <span className="intelligence-notification-row-title">{title}</span>
        <Popover
          labelKey={props.infoKey}
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
