import type { ReactElement } from 'react'

/**
 * 左边这一列：四项 + 状态词（界面规范 v1.9 §8、v2.39 §9f）。
 *
 * 状态词**只在列表行出现一次**：详情标题不重复同一句，两处都写迟早会有一次说法不同。
 * 窄窗（容器 < 860）收成顶部下拉，名字与状态都进选项文本——图标认不出是哪一项。
 */
export type NotificationListItem = Readonly<{ key: string; name: string; state: string }>

export function NotificationList(props: Readonly<{
  items: readonly NotificationListItem[]
  selected: string
  narrow: boolean
  ariaLabel: string
  onSelect: (key: string) => void
}>): ReactElement {
  if (props.narrow) {
    return <div className="intelligence-notification-narrow">
      <label className="intelligence-notification-narrow-label">
        {props.ariaLabel}
        <select
          aria-label={props.ariaLabel}
          onChange={(event) => props.onSelect(event.target.value)}
          value={props.selected}
        >
          {props.items.map((item) => (
            <option key={item.key} value={item.key}>{`${item.name} · ${item.state}`}</option>
          ))}
        </select>
      </label>
    </div>
  }

  return <ul aria-label={props.ariaLabel} className="intelligence-notification-list">
    {props.items.map((item) => (
      <li key={item.key}>
        <button
          aria-current={props.selected === item.key ? 'true' : undefined}
          className="intelligence-notification-list-item"
          onClick={() => props.onSelect(item.key)}
          type="button"
        >
          <span className="intelligence-notification-list-name" title={item.name}>{item.name}</span>
          <span className="intelligence-notification-list-state" title={item.state}>{item.state}</span>
        </button>
      </li>
    ))}
  </ul>
}
