import { Modal as AntModal } from 'antd'
import type { ReactElement, ReactNode } from 'react'

import { fillLabelParams } from '../textKeyParams'
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
 * 三格闭集（Chief 2026-11-02 定）：
 * - `align`：`top` / `center`，默认 `top`。**不给 `centered` 布尔**——居中与不居中是两种形态，
 *   不是一个开关；
 * - `layer`：`base` / `over-drawer`，默认 `base`。1400/1500 两个具体值收在组件内的表里，
 *   调用方不收数字；
 * - `titleParams`：运行时数据的标题走键 + 参数，参数是**已格式化好的字符串**，与抽屉同一条实现。
 *
 * 宽度四档（架构师 2026-11-02 定，`compact` 到 `maximum`）：名字不复用 `StateSize` 的密度词，
 * 也不复用 `Drawer` 的宽度词——两套数值不同，同名不同值比两套词更难查。像素表只在下面一处；
 * 调用点不传数字。`antd` 自己的 `max-width: calc(100vw - 32px)` 负责窄窗口，不另写一个 92vw。
 */

/** 四档宽度，仅此四档。像素只在下面这张表里出现一次。 */
export const MODAL_WIDTHS = ['compact', 'standard', 'expanded', 'maximum'] as const

export type ModalWidth = (typeof MODAL_WIDTHS)[number]

const WIDTH_PX: Record<ModalWidth, number> = { compact: 420, standard: 520, expanded: 720, maximum: 860 }

/** 两种形态，仅此两种。`center` 不是「更好看」，而是另一种语义：任务在屏幕正中。 */
export const MODAL_ALIGNS = ['top', 'center'] as const

export type ModalAlign = (typeof MODAL_ALIGNS)[number]

/** 两档，仅此两档。具体 z-index 只在下面这张表里出现一次。 */
export const MODAL_LAYERS = ['base', 'over-drawer'] as const

export type ModalLayer = (typeof MODAL_LAYERS)[number]

/** `base` 不传，保持 antd 默认层；`over-drawer` 取现有弹窗层里最高的一档。 */
const LAYER_Z_INDEX: Record<ModalLayer, number | undefined> = { base: undefined, 'over-drawer': 1500 }

type ModalBase = {
  open: boolean
  /** 每次调用回答一次「这只弹窗要多宽」。不给默认值。 */
  width: ModalWidth
  /** 遮罩点击、Esc 与关闭键共用。 */
  onClose: () => void
  /** 底部动作区；不传即不渲染，按钮由调用方给（组件不内置保存/取消）。 */
  footer?: ReactNode
  children: ReactNode
  /** 旧类名只经这里透传；不承载宽度或布局。 */
  className?: string
  /** 任务在屏幕顶部还是正中；默认 `top`，与 antd 默认一致。 */
  align?: ModalAlign
  /** 普通层，或压在抽屉之上（模型服务那 4 处）。 */
  layer?: ModalLayer
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传键回显）。 */
  resolveText: (key: string) => string
}

/** 标题两档互斥：有可见标题，或没有标题但必须给读屏名。 */
type ModalHeading =
  | {
      /** 标题的 i18n 键；不收句子。 */
      titleKey: string
      /** 填标题模板 `{name}` 的值，**只收已经格式化好的字符串**（`3 条`、`10–2`）。 */
      titleParams?: Readonly<Record<string, string>>
      ariaLabelKey?: never
    }
  | {
      titleKey?: never
      /** 无标题弹窗的读屏名；缺了它读屏只会念「对话框」。 */
      ariaLabelKey: string
    }

export type ModalProps = ModalBase & ModalHeading

export function Modal(props: ModalProps): ReactElement {
  const { open, width, onClose, footer, children, className, resolveText, align = 'top', layer = 'base' } = props
  const headless = props.titleKey === undefined
  const closeLabel = useModalText()()
  const zIndex = LAYER_Z_INDEX[layer]

  // 无标题档也要有名字：把读屏名做成视觉隐藏的标题，它同时是 `aria-labelledby` 的落点。
  // rc-dialog 只在有 title 时写 `aria-labelledby`，没有 `aria-label` 通道（rc-dialog Panel.js）。
  const title = headless ? (
    <span className="modal__sr-only">{resolveText(props.ariaLabelKey)}</span>
  ) : (
    <span className="modal__title">{fillLabelParams(resolveText(props.titleKey), props.titleParams)}</span>
  )

  return (
    <AntModal
      open={open}
      onCancel={onClose}
      title={title}
      width={WIDTH_PX[width]}
      // antd 的默认页脚是「确定/取消」；不显式给 null，「不传即不渲染」就是假的。
      footer={footer ?? null}
      // 关闭键归组件：名字来自本组件文案表；按钮本身仍由 antd 提供（键盘、焦点、位置不变）。
      closable={{ 'aria-label': closeLabel }}
      // 居中与不居中是两种形态：由闭集 `align` 决定，不收 `centered` 布尔。
      centered={align === 'center'}
      // 层级由闭集决定；`base` 不发 zIndex，保持 antd 默认。
      {...(zIndex === undefined ? {} : { zIndex })}
      // 无标题档藏掉标题栏，但保留隐藏标题作为读屏名。
      {...(headless ? { styles: { header: { display: 'none' } } } : {})}
      className={['modal', className].filter(Boolean).join(' ')}>
      {children}
    </AntModal>
  )
}
