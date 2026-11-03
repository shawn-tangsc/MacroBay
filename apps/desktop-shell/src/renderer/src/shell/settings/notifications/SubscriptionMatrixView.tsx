import type { NotificationCopyLanguage } from '@platform/i18n/notificationCopy'
import { notificationCopy } from '@platform/i18n/notificationCopy'

import type { NotificationSettingsText } from './notificationSettingsText'
import type { SubscriptionCell, SubscriptionRow } from './subscriptionMatrix'

/**
 * 订阅清单的三列表格（15 行 × 记录 / 桌面 / 通道）。
 *
 * 这一块只做一件事：把模型算好的**格子形态**画出来。形态判断在 `subscriptionMatrix.ts`，
 * 所以「未批准」永远不会被画成禁用的勾——那是这一页最容易犯、而且看起来最合理的错。
 *
 * 键盘与读屏（规范 §7）：
 * - 「固定开启」与「已记录」不是控件，**不进 Tab**；
 * - 未批准格是灰色「—」+ 一句读屏原因，也不是控件；
 * - 通道整列禁用时，原因只在列头写一次，禁用的勾用 `aria-describedby` 指过去。
 */
export const CHANNEL_BLOCKED_REASON_ID = 'notification-subs-channel-blocked'

export function SubscriptionMatrixView(props: {
  rows: readonly SubscriptionRow[]
  text: NotificationSettingsText
  language: NotificationCopyLanguage
  channelAvailable: boolean
  onToggle: (id: string, level: 'record' | 'desktop' | 'channel', next: boolean) => void
}): React.ReactElement {
  const { rows, text, language, channelAvailable } = props
  const title = (key: string): string => notificationCopy[language][key as keyof (typeof notificationCopy)['en-US']] ?? key

  const columnReason = (cell: SubscriptionCell, level: 'desktop' | 'channel'): string | null => {
    if (cell.kind === 'not-approved') return level === 'desktop' ? text.notApprovedDesktop : text.notApprovedChannel
    return null
  }

  return (
    <div className="notification-subs" data-notification-subs>
      <div className="notification-subs-head" role="row">
        <span className="notification-subs-head-cell">{text.subsHeading}</span>
        <span className="notification-subs-head-cell">{text.subsColRecord}</span>
        <span className="notification-subs-head-cell">{text.subsColDesktop}</span>
        <span className="notification-subs-head-cell">
          {text.subsColChannel}
          {channelAvailable ? null : (
            // 原因只在列头写一次：15 行各写一遍，读者会以为每一行都有自己的毛病。
            <small className="notification-subs-head-reason" id={CHANNEL_BLOCKED_REASON_ID}>
              {text.subsChannelBlocked}
            </small>
          )}
        </span>
      </div>

      {rows.map((row) => (
        <div className="notification-subs-row" role="row" key={row.id} data-event-id={row.id}>
          <span className="notification-subs-name">{title(row.titleKey)}</span>
          <Cell
            cell={row.record}
            column="record"
            label={`${title(row.titleKey)} · ${text.subsColRecord}`}
            text={text}
            channelAvailable={channelAvailable}
            onToggle={(next) => props.onToggle(row.id, 'record', next)}
          />
          <Cell
            cell={row.desktop}
            column="desktop"
            label={`${title(row.titleKey)} · ${text.subsColDesktop}`}
            text={text}
            channelAvailable={channelAvailable}
            reason={columnReason(row.desktop, 'desktop')}
            onToggle={(next) => props.onToggle(row.id, 'desktop', next)}
          />
          <Cell
            cell={row.channel}
            column="channel"
            label={`${title(row.titleKey)} · ${text.subsColChannel}`}
            text={text}
            channelAvailable={channelAvailable}
            onToggle={(next) => props.onToggle(row.id, 'channel', next)}
          />
        </div>
      ))}
    </div>
  )
}

function Cell(props: {
  cell: SubscriptionCell
  column: 'record' | 'desktop' | 'channel'
  label: string
  text: NotificationSettingsText
  channelAvailable: boolean
  reason?: string | null
  onToggle: (next: boolean) => void
}): React.ReactElement {
  const { cell, text } = props

  if (cell.kind === 'fixed') {
    // 不是控件、不进 Tab：读屏只念一次「固定开启」。
    return (
      <span className="notification-subs-cell">
        <span className="notification-subs-fixed">{text.centerFixed}</span>
      </span>
    )
  }

  if (cell.kind === 'recorded-via-delivery') {
    // 生效值为真但不可关：关它等于「我要收，但不要它被记下来」。
    return (
      <span className="notification-subs-cell">
        <span className="notification-subs-recorded">{text.recordedVia(text.subsColDesktop)}</span>
      </span>
    )
  }

  if (cell.kind === 'not-approved') {
    return (
      <span className="notification-subs-cell">
        <span className="notification-subs-dash" aria-hidden="true">
          —
        </span>
        <span className="notification-subs-sr">{props.reason ?? ''}</span>
      </span>
    )
  }

  return (
    <span className="notification-subs-cell">
      <input
        type="checkbox"
        className="notification-subs-check"
        aria-label={props.label}
        checked={cell.checked}
        disabled={cell.disabled}
        aria-describedby={props.column === 'channel' && !props.channelAvailable ? CHANNEL_BLOCKED_REASON_ID : undefined}
        onChange={(event) => props.onToggle(event.currentTarget.checked)}
      />
    </span>
  )
}
