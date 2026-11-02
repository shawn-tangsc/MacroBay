import { X } from 'lucide-react'
import type { ReactElement } from 'react'

import { IconButton } from '../icon-button'
import { TOAST_CLOSE_KEY, useToastText } from './toastText'

/**
 * 一条提示（规格：`docs-private/05-desktop/ui-audit/2026-11-02-toast-metaphich.html` ①）。
 *
 * 颜色只在左侧 2px 竖条上，正文一律正文色——读者是来读那句话的，不是来看色块的。
 * `role="status"` + `aria-live="polite"`，**不用 `alert`**：`alert` 是 assertive，会打断正在朗读的内容。
 *
 * 这里收的是**已经解析好的句子**，不是键：宿主不再持有一张全仓文案表，解析在调用点完成
 * （见 `ToastHost` 的入队说明）。所以本组件里也没有 `resolveText`。
 */

export const TOAST_TONES = ['success', 'danger', 'info'] as const
export type ToastTone = (typeof TOAST_TONES)[number]

export type ToastItemProps = {
  tone: ToastTone
  title: string
  description?: string
  /** 危险档在类型上强制带动作（见 `ToastInput`）；成功与信息档可选。 */
  action?: { label: string; onSelect: () => void }
  onDismiss: () => void
}

export function ToastItem({ tone, title, description, action, onDismiss }: ToastItemProps): ReactElement {
  const closeLabel = useToastText()()

  return (
    <div aria-live="polite" className={['toast', `toast--${tone}`].join(' ')} role="status">
      <div className="toast__body">
        <div className="toast__title">{title}</div>
        {description === undefined ? null : <p className="toast__desc">{description}</p>}
        {action === undefined ? null : (
          <button className="toast__action" onClick={action.onSelect} type="button">
            {action.label}
          </button>
        )}
      </div>
      <IconButton
        ariaLabelKey={TOAST_CLOSE_KEY}
        icon={X}
        onSelect={onDismiss}
        // 关闭键的名字是组件常量：不让调用方的解析器有机会把它变成空串。
        resolveText={(key) => (key === TOAST_CLOSE_KEY ? closeLabel : key)}
        size="sm"
      />
    </div>
  )
}
