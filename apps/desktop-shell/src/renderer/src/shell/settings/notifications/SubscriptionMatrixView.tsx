import type { NotificationCopyLanguage } from '@platform/i18n/notificationCopy'
import { notificationCopy } from '@platform/i18n/notificationCopy'

import type { NotificationSettingsText } from './notificationSettingsText'
import type { SubscriptionCell, SubscriptionRow } from './subscriptionMatrix'

/**
 * 订阅清单的表格（按目录渲染，两列：记录 / 桌面）。
 *
 * 通道那一列已摘掉：那个能力还不存在，列头写着「通道」就是在承诺收不到的东西。
 *
 * 这一块只做一件事：把模型算好的**格子形态**画出来。形态判断在 `subscriptionMatrix.ts`，
 * 所以「未批准」永远不会被画成禁用的勾——那是这一页最容易犯、而且看起来最合理的错。
 *
 * 键盘与读屏（规范 §7）：
 * - 「固定开启」与「已记录」不是控件，**不进 Tab**；
 * - 未批准格是灰色「—」+ 一句读屏原因，也不是控件；
 */
export function SubscriptionMatrixView(props: {
  rows: readonly SubscriptionRow[]
  text: NotificationSettingsText
  language: NotificationCopyLanguage
  onToggle: (id: string, level: 'record' | 'desktop', next: boolean) => void
}): React.ReactElement {
  const { rows, text, language } = props
  const title = (key: string): string => notificationCopy[language][key as keyof (typeof notificationCopy)['en-US']] ?? key

  const columnReason = (cell: SubscriptionCell): string | null =>
    cell.kind === 'not-approved' ? text.notApprovedDesktop : null

  return (
    <div className="notification-subs" data-notification-subs>
      <div className="notification-subs-head" role="row">
        <span className="notification-subs-head-cell">{text.subsHeading}</span>
        <span className="notification-subs-head-cell">{text.subsColRecord}</span>
        <span className="notification-subs-head-cell">{text.subsColDesktop}</span>
      </div>

      {rows.map((row) => (
        <div className="notification-subs-row" role="row" key={row.id} data-event-id={row.id}>
          <span className="notification-subs-name">{title(row.titleKey)}</span>
          <Cell
            cell={row.record}
            column="record"
            label={`${title(row.titleKey)} · ${text.subsColRecord}`}
            text={text}
            onToggle={(next) => props.onToggle(row.id, 'record', next)}
          />
          <Cell
            cell={row.desktop}
            column="desktop"
            label={`${title(row.titleKey)} · ${text.subsColDesktop}`}
            text={text}
            reason={columnReason(row.desktop)}
            onToggle={(next) => props.onToggle(row.id, 'desktop', next)}
          />
        </div>
      ))}
    </div>
  )
}

function Cell(props: {
  cell: SubscriptionCell
  column: 'record' | 'desktop'
  label: string
  text: NotificationSettingsText
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
        onChange={(event) => props.onToggle(event.currentTarget.checked)}
      />
    </span>
  )
}
