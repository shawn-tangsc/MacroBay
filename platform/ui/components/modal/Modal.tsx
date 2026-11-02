import { Modal as AntModal } from 'antd'
import type { ReactElement, ReactNode } from 'react'

import { useModalText } from './modalText'

import './modal.css'

/**
 * 模态弹窗的骨架（带表单、带长内容的弹窗；确认框归 `confirm`）。
 *
 * 基础：包 antd `Modal`。遮罩、焦点陷阱、滚动锁、Esc、焦点回位都是它的能力，我们不重写。
 *
 * 现在只落**已定**的四件事：
 * - 标题二选一：`titleKey`（收键）或 `ariaLabelKey`（无标题时必填）——类型上互斥，
 *   不给「两样都不传」留口子；没有名字的对话框，读屏只会念「对话框」；
 * - `footer` 槽：**不传即不渲染按钮区**，不是 `footer={null}` 那种开关；
 * - 关闭键归组件：按钮仍是 antd 那个，名字换成本组件文案表的常量，
 *   **不经过**调用方的 `resolveText`（那条路未知键会返回空串）；
 * - `resolveText` 只解析标题/读屏名，组件内零文案、零 i18n import。
 *
 * **还没落、也不在这里猜的**：宽度档位（闭集值待契约）、`centered`、层级、运行时数据标题。
 * 现状与裁决点见 `docs-private/05-desktop/ui-audit/modal-call-site-requirements-2026-11-02.md`；
 * 在档位定稿前，**不要迁移调用点**——一个只能用 antd 默认宽度的弹窗，迁过去就是把宽度偷偷定成 520。
 */

type ModalBase = {
  open: boolean
  /** 遮罩点击、Esc 与关闭键共用。 */
  onClose: () => void
  /** 底部动作区；不传即不渲染，按钮由调用方给（组件不内置保存/取消）。 */
  footer?: ReactNode
  children: ReactNode
  /** 旧类名只经这里透传；不承载宽度或布局。 */
  className?: string
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传键回显）。 */
  resolveText: (key: string) => string
}

/** 标题两档互斥：有可见标题，或没有标题但必须给读屏名。 */
type ModalHeading =
  | {
      /** 标题的 i18n 键；不收句子。 */
      titleKey: string
      ariaLabelKey?: never
    }
  | {
      titleKey?: never
      /** 无标题弹窗的读屏名；缺了它读屏只会念「对话框」。 */
      ariaLabelKey: string
    }

export type ModalProps = ModalBase & ModalHeading

export function Modal(props: ModalProps): ReactElement {
  const { open, onClose, footer, children, className, resolveText } = props
  const headless = props.titleKey === undefined
  const closeLabel = useModalText()()

  // 无标题档也要有名字：把读屏名做成视觉隐藏的标题，它同时是 `aria-labelledby` 的落点。
  // rc-dialog 只在有 title 时写 `aria-labelledby`，没有 `aria-label` 通道（rc-dialog Panel.js）。
  const title = headless ? (
    <span className="modal__sr-only">{resolveText(props.ariaLabelKey)}</span>
  ) : (
    <span className="modal__title">{resolveText(props.titleKey)}</span>
  )

  return (
    <AntModal
      open={open}
      onCancel={onClose}
      title={title}
      // antd 的默认页脚是「确定/取消」；不显式给 null，「不传即不渲染」就是假的。
      footer={footer ?? null}
      // 关闭键归组件：名字来自本组件文案表；按钮本身仍由 antd 提供（键盘、焦点、位置不变）。
      closable={{ 'aria-label': closeLabel }}
      // 无标题档藏掉标题栏，但保留隐藏标题作为读屏名。
      {...(headless ? { styles: { header: { display: 'none' } } } : {})}
      className={['modal', className].filter(Boolean).join(' ')}>
      {children}
    </AntModal>
  )
}
