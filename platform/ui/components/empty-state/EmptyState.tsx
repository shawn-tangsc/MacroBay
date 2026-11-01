import { useId, type ReactElement, type ReactNode } from 'react'

/**
 * 空态的唯一组件（B0 契约：`docs-private/05-desktop/ui-state-components-contract.md`）。
 *
 * 组件内**零文案、零 i18n**：标题、原因、动作文案全部由调用方给，和 `LoadingState` 同形。
 * 基座 DOM 固定为 `div.empty-state > [icon?] + strong + span [action?]`；`action` 不传时
 * **不渲染任何包裹元素**，否则每处迁移都会多一层间距，逐块比对必挂。
 *
 * 它不表达「加载」，也不表达「出错」：等待走 `LoadingState`，错误走 `ErrorState`。
 * 一个组件同时背两种语义、靠布尔值让调用方猜，是这一轮要拆掉的病。
 */
export type StateSize = 'sm' | 'md' | 'lg'

export type EmptyStateAction = {
  label: string
  onPress: () => void
  /**
   * 有值即禁用，并把理由挂到 `aria-describedby` 指向的 `role="note"` 节点上。
   * 不用 `title`：读屏不念、触屏不出现——禁用原因必须两种入口都够得着。
   */
  disabledReason?: string
}

export type EmptyStateProps = {
  /** 这是什么、现在什么状态。 */
  title: string
  /** 为什么空。缺这句就退化成「暂无数据」。 */
  reason: string
  /** 装饰性图标；图标本身已 `aria-hidden`，不要用图标代替文字。 */
  icon?: ReactNode
  /** 下一步。给不出动作就不传，改在 `reason` 里写「怎么才会出现」。 */
  action?: EmptyStateAction
  size?: StateSize
  /** 迁移期承载旧类名，保证存量样式继续生效。 */
  className?: string
}

export function EmptyState({
  title,
  reason,
  icon,
  action,
  size = 'md',
  className
}: EmptyStateProps): ReactElement {
  const noteId = useId()

  return (
    <div
      className={className ? `empty-state ${className}` : 'empty-state'}
      data-size={size}>
      {icon}
      <strong>{title}</strong>
      <span>{reason}</span>
      {action ? (
        <button
          type="button"
          className="empty-state-action"
          disabled={Boolean(action.disabledReason)}
          {...(action.disabledReason ? { 'aria-describedby': noteId } : {})}
          onClick={action.onPress}>
          {action.label}
        </button>
      ) : null}
      {action?.disabledReason ? (
        <span id={noteId} role="note">
          {action.disabledReason}
        </span>
      ) : null}
    </div>
  )
}
