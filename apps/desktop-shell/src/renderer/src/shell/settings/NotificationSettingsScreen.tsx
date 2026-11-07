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
  /** 回执：一句主句 + 可选的原因码。码只在折叠区，不进主句（界面规范 v2.27 §2）。 */
  const [receipt, setReceipt] = useState<{ sentence: string; code?: string } | null>(null)
  /** 写失败只有一句、只在原地：不把开关自己点亮，也不给内部码。 */
  const [writeFailed, setWriteFailed] = useState(false)

  const save = async (write: Promise<{ ok: boolean }>): Promise<void> => {
    const result = await write
    setWriteFailed(!result.ok)
  }

  const runTest = async (): Promise<void> => {
    try {
      // `link` = 平台链路自检：走完整真实链路（含手机通道），样例固定、不绑任何情报事件。
      const result = await client.sendTest?.({ kind: 'link' })
      if (result === undefined) {
        // 没有这个方法（旧构建 / preload 没接）：只说没发出去，不给码。
        setReceipt({ sentence: text.testUnavailable })
        return
      }
      if (result.state === 'sent') {
        // 成功必须点名通道：「已发到 {通道名}（测试）」。
        setReceipt({ sentence: text.testSentToChannel(result.channelName) })
        return
      }
      // `link` 永远有样例，所以只剩「发不出去」；原因码进折叠区，不进主句。
      setReceipt({ sentence: text.testUnavailable, code: result.reasonCode })
    } catch {
      // 连回执都没拿到：只说没发出去，不编一个码。
      setReceipt({ sentence: text.testUnavailable })
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
              <div data-send-test-result>
                <p className="notification-settings-result" role="status" aria-live="polite">
                  {receipt.sentence}
                </p>
                {receipt.code === undefined ? null : (
                  // 原因码只在这里：默认收起、不进主句、不进 ⓘ。
                  <details className="notification-settings-reason">
                    <summary>{text.reasonCode}</summary>
                    <code>{receipt.code}</code>
                  </details>
                )}
              </div>
            )}
          </section>

          <footer className="notification-footer">
            <span>{text.footerLine}</span>
            <Popover
              lines={[{ labelKey: 'notifications.center.desc' }, { labelKey: 'notifications.footer.hint' }]}
              resolveText={(key: 'notifications.center.desc' | 'notifications.footer.hint') =>
                key === 'notifications.center.desc' ? text.centerDesc : text.footerHint
              }
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
