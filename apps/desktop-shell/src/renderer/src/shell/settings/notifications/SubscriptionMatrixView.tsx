import type { NotificationSettingsText } from './notificationSettingsText'
import type { SubscriptionCell, SubscriptionRow } from './subscriptionMatrix'

/**
 * 订阅清单的表格（按目录渲染：记录 / 桌面，频道就绪时多一列「频道」）。
 *
 * 频道列**整列**跟着就绪状态出现或消失，不是逐格禁用：一串禁用的勾等于承诺「勾上就能推到手机」，
 * 而那一列勾了也不会响。没就绪时连列头都不画（规范 §2.2）。
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
  onToggle: (id: string, level: 'record' | 'desktop' | 'channel', next: boolean) => void
}): React.ReactElement {
  const { rows, text } = props
  // 一列都不许自己判断：这一列在不在，看模型给的格子是不是 null（`channelReady` 的结果）。
  const withChannel = rows.some((row) => row.channel !== null)
  // 行名按事件 id 取这一屏自己的名字：**读不到就说「暂时读不出来」，绝不回显键名或事件 id**。
  // 之前这里只查平台通知词表、查不到就 `?? key`，情报那 7 行因此把内部键印在了屏幕上。
  const title = (id: string): string => text.eventNames[id] ?? text.subsNameUnavailable

  const columnReason = (cell: SubscriptionCell, column: 'desktop' | 'channel'): string | null =>
    cell.kind === 'not-approved' ? (column === 'desktop' ? text.notApprovedDesktop : text.notApprovedChannel) : null

  return (
    <div
      className={withChannel ? 'notification-subs notification-subs--channel' : 'notification-subs'}
      data-notification-subs
      data-channel-column={withChannel ? 'shown' : 'hidden'}
    >
      <div className="notification-subs-head" role="row">
        <span className="notification-subs-head-cell">{text.subsHeading}</span>
        <span className="notification-subs-head-cell">{text.subsColRecord}</span>
        <span className="notification-subs-head-cell">{text.subsColDesktop}</span>
        {withChannel ? <span className="notification-subs-head-cell">{text.subsColChannel}</span> : null}
      </div>

      {rows.map((row) => (
        <div className="notification-subs-row" role="row" key={row.id} data-event-id={row.id}>
          <span className="notification-subs-name">{title(row.id)}</span>
          <Cell
            cell={row.record}
            column="record"
            label={`${title(row.id)} · ${text.subsColRecord}`}
            text={text}
            onToggle={(next) => props.onToggle(row.id, 'record', next)}
          />
          <Cell
            cell={row.desktop}
            column="desktop"
            label={`${title(row.id)} · ${text.subsColDesktop}`}
            text={text}
            reason={columnReason(row.desktop, 'desktop')}
            onToggle={(next) => props.onToggle(row.id, 'desktop', next)}
          />
          {row.channel === null ? null : (
            <Cell
              cell={row.channel}
              column="channel"
              label={`${title(row.id)} · ${text.subsColChannel}`}
              text={text}
              reason={columnReason(row.channel, 'channel')}
              onToggle={(next) => props.onToggle(row.id, 'channel', next)}
            />
          )}
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
    // 生效值为真但不可关：关它等于「我要收，但不要它被记下来」。句子要说是哪个投递档顶起来的。
    const surfaces = cell.surfaces
      .map((surface) => (surface === 'desktop' ? text.subsColDesktop : text.subsColChannel))
      .join(text.surfaceJoin)
    return (
      <span className="notification-subs-cell">
        <span className="notification-subs-recorded">{text.recordedVia(surfaces)}</span>
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
