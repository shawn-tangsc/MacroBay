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
    // 只管读屏：页标题已经写着「情报通知」，再给一个可见标签就是同一句话说两遍。
    return <div className="intelligence-notification-narrow">
      <select
        aria-label={props.ariaLabel}
        onChange={(event) => props.onSelect(event.target.value)}
        value={props.selected}
      >
        {props.items.map((item) => (
          <option key={item.key} value={item.key}>{`${item.name} · ${item.state}`}</option>
        ))}
      </select>
    </div>
  }

  return <ul aria-label={props.ariaLabel} className="intelligence-notification-list">
    {props.items.map((item) => (
      <li key={item.key}>
        {/* 例外登记（ui-spec R1）：这是**两行内容的列表行容器**（名字 + 状态），不是命令按钮。
            antd `Button` 会把子节点包进自己的 span 并带 padding/height，可见形状会变，所以保留
            原生按钮、不覆写内联样式去模拟；语义自带：名字取行内文本、键盘可达、选中态 `aria-current`。 */}
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
