import { X } from 'lucide-react'
import type { ReactElement } from 'react'

import { IconButton } from '../icon-button'
import { TOAST_CLOSE_KEY, useToastText } from './toastText'

/**
 * 一条提示（规格：`docs-private/05-desktop/ui-audit/2026-11-02-toast-metaphich.html` ①）。
 *
 * 颜色只在左侧 2px 竖条上，正文一律正文色——读者是来读那句话的，不是来看色块的。
 * `role="status"` + `aria-live="polite"`，**不用 `alert`**：`alert` 是 assertive，会打断正在朗读的内容。
 */

export const TOAST_TONES = ['success', 'danger', 'info'] as const
export type ToastTone = (typeof TOAST_TONES)[number]

export type ToastAction = {
  labelKey: string
  onSelect: () => void
}

export type ToastItemProps = {
  tone: ToastTone
  titleKey: string
  descKey?: string
  /** 危险档在类型上强制带动作（见 `ToastInput`）；成功与信息档可选。 */
  action?: ToastAction
  onDismiss: () => void
  resolveText: (key: string) => string
}

export function ToastItem({ tone, titleKey, descKey, action, onDismiss, resolveText }: ToastItemProps): ReactElement {
  const closeLabel = useToastText()()

  return (
    <div aria-live="polite" className={['toast', `toast--${tone}`].join(' ')} role="status">
      <div className="toast__body">
        <div className="toast__title">{resolveText(titleKey)}</div>
        {descKey === undefined ? null : <p className="toast__desc">{resolveText(descKey)}</p>}
        {action === undefined ? null : (
          <button className="toast__action" onClick={action.onSelect} type="button">
            {resolveText(action.labelKey)}
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
