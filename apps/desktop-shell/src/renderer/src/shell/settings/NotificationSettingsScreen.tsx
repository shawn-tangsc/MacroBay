import { useState } from 'react'
import { Info } from 'lucide-react'
import { Button, Switch } from 'antd'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { StateView } from '@platform/ui/components/state'

import './notifications/notificationSettings.css'
import { notificationSettingsText, type NotificationSettingsText } from './notifications/notificationSettingsText'
import { describeTestReceipt } from './notifications/testReceipt'
import { useNotificationSettingsData, type NotificationSettingsClient } from './notifications/useNotificationSettingsData'

/** ⓘ 的读屏名：只收键（点分、无空白、无中文），句子由这一屏的解析器给出。 */
const HINT_KEY_TOAST = 'settings.notifications.hint.toast'
const HINT_KEY_DESKTOP = 'settings.notifications.hint.desktop'
const HINT_KEY_FOOTER = 'settings.notifications.hint.footer'

type HintKey = typeof HINT_KEY_TOAST | typeof HINT_KEY_DESKTOP | typeof HINT_KEY_FOOTER

function hintText(key: HintKey, text: NotificationSettingsText): string {
  if (key === HINT_KEY_TOAST) return text.toastHint
  if (key === HINT_KEY_DESKTOP) return text.desktopHint
  return text.footerHint
}

/** 三个 ⓘ 的读屏名：按传入的键给出控件名，不是「不管什么键都吐同一句」。 */
function hintLabel(key: string, text: NotificationSettingsText): string {
  if (key === HINT_KEY_TOAST) return text.toastHintLabel
  if (key === HINT_KEY_DESKTOP) return text.desktopHintLabel
  if (key === HINT_KEY_FOOTER) return text.footerHintLabel
  return ''
}

/**
 * 设置 → 通知（规范 v2.27 §2）。
 *
 * 这一页只剩两个开关 + 一个测试按钮 + 页脚。**订阅矩阵、频道选择、「固定开启」在 v2.20 整块撤销**：
 * 「其余的都是内置规则，只要用户开了就会推，没开就不会推」——不给逐条勾选，就没有清单。
 *
 * 三条硬规矩落在这里：
 * - 说明只进 ⓘ，页面上每块最多一行；没有 ⓘ 的块一句话都不写；
 * - 开关**存上才亮**：写失败时留在原位，就地一句「这次没有保存上」，不显示内部码；
 * - 页面上不出现任何条数（事件类目数会跟批准表漂移，只在规范里记）。
 */
export function NotificationSettingsScreen(props: {
  title: string
  notice?: string | null
  language: AppLanguage
  client?: NotificationSettingsClient
}): React.ReactElement {
  const text = notificationSettingsText[props.language]
  const client = props.client ?? (window.platform?.notifications as NotificationSettingsClient)
  const { state, reload, setToast, setDesktop } = useNotificationSettingsData(client)
  const [receipt, setReceipt] = useState<string | null>(null)
  /** 写失败只有一句、只在原地：不把开关自己点亮，也不给内部码。 */
  const [writeFailed, setWriteFailed] = useState(false)

  const save = async (write: Promise<{ ok: boolean }>): Promise<void> => {
    const result = await write
    setWriteFailed(!result.ok)
  }

  const runTest = async (): Promise<void> => {
    try {
      // 类型由主进程标好：直接取字段，不再手写形状。
      const result = await client.sendTest?.()
      setReceipt(
        describeTestReceipt({
          delivery: result?.delivery ?? [],
          toastEnabled: state.status === 'ready' && state.data.toastEnabled,
          text
        })
      )
    } catch {
      // 抛出来连「交给系统了」都没拿到：只说失败，并如实写「原因不明」。
      setReceipt(text.desktopFailed(text.reasonUnknown))
    }
  }

  return (
    <section className="settings-detail-pane preferences-pane notification-settings-pane">
      <div className="section-heading">
        <span>{props.title}</span>
        {props.notice ? <small>{props.notice}</small> : null}
      </div>

      {state.status === 'loading' ? <LoadingState label={text.loading} /> : null}

      {state.status === 'error' ? (
        // 「读不到」与「两个都关着」是两件事：这里给重试，绝不拿默认值冒充现状。
        <StateView
          state="error"
          reasonCode="unreadable"
          action={{ labelKey: 'ui.state.action.retry', onSelect: reload }}
        />
      ) : null}

      {state.status === 'ready' ? (
        <div className="notification-card" data-notification-settings-card>
          {writeFailed ? (
            <p className="notification-settings-write-failed" role="alert" data-notification-write-failed>
              {text.writeFailed}
            </p>
          ) : null}

          <section className="notification-group" aria-label={text.localGroup}>
            <h3 className="notification-group-title">{text.localGroup}</h3>

            <SwitchRow
              name={text.toastRow}
              hintKey={HINT_KEY_TOAST}
              text={text}
              control={
                <Switch
                  size="small"
                  checked={state.data.toastEnabled}
                  aria-label={text.toastRow}
                  onChange={(next) => void save(setToast(next))}
                  data-row-switch="toast"
                />
              }
            />

            <SwitchRow
              name={text.desktopRow}
              hintKey={HINT_KEY_DESKTOP}
              text={text}
              control={
                <Switch
                  size="small"
                  checked={state.data.desktopEnabled}
                  aria-label={text.desktopRow}
                  onChange={(next) => void save(setDesktop(next))}
                  data-row-switch="desktop"
                />
              }
            />
          </section>

          <section className="notification-group" aria-label={text.testGroup}>
            <h3 className="notification-group-title">{text.testGroup}</h3>
            <div className="notification-row" data-row="test">
              <span className="notification-row-copy">
                <strong>{text.sendTestRow}</strong>
              </span>
              <span className="notification-row-control">
                <Button size="small" onClick={() => void runTest()} data-send-test>
                  {text.sendTest}
                </Button>
              </span>
            </div>
            {receipt === null ? null : (
              // aria-live：回执各播报一次，重复点击只更新同一处，不堆消息。
              <p className="notification-settings-result" role="status" aria-live="polite" data-send-test-result>
                {receipt}
              </p>
            )}
          </section>

          <footer className="notification-footer">
            <span>{text.footerLine}</span>
            <Popover
              lines={[{ labelKey: 'centerDesc' }, { labelKey: 'footerHint' }]}
              resolveText={(key: 'centerDesc' | 'footerHint') => text[key]}
              trigger={(triggerProps) => (
                <IconButton
                  ariaLabelKey={HINT_KEY_FOOTER}
                  icon={Info}
                  size="sm"
                  variant="plain"
                  resolveText={(key: string) => hintLabel(key, text)}
                  onSelect={triggerProps.onSelect}
                  onMouseEnter={triggerProps.onMouseEnter}
                  onMouseLeave={triggerProps.onMouseLeave}
                  onFocus={triggerProps.onFocus}
                  onBlur={triggerProps.onBlur}
                  expanded={triggerProps.expanded}
                />
              )}
            />
          </footer>
        </div>
      ) : null}
    </section>
  )
}

/** 一行「名字 + ⓘ + 控件」。ⓘ 用平台 `Popover`（hover 开、点住、Esc 关并还焦）。 */
function SwitchRow(props: {
  name: string
  hintKey: HintKey
  text: NotificationSettingsText
  control: React.ReactElement
}): React.ReactElement {
  const { text } = props
  return (
    <div className="notification-row" data-row={props.hintKey === HINT_KEY_TOAST ? 'toast' : 'desktop'}>
      <span className="notification-row-copy">
        <strong>{props.name}</strong>
        <Popover
          labelKey={props.hintKey}
          resolveText={(key: HintKey) => hintText(key, text)}
          trigger={(triggerProps) => (
            <IconButton
              ariaLabelKey={props.hintKey}
              icon={Info}
              size="sm"
              variant="plain"
              resolveText={(key: string) => hintLabel(key, text)}
              onSelect={triggerProps.onSelect}
              onMouseEnter={triggerProps.onMouseEnter}
              onMouseLeave={triggerProps.onMouseLeave}
              onFocus={triggerProps.onFocus}
              onBlur={triggerProps.onBlur}
              expanded={triggerProps.expanded}
            />
          )}
        />
      </span>
      <span className="notification-row-control">{props.control}</span>
    </div>
  )
}
