import { Drawer as AntDrawer } from 'antd'
import { X } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import { IconButton } from '../icon-button'
import { useDrawerText } from './drawerText'

import './drawer.css'

/**
 * 抽屉（契约：`docs-private/05-desktop/ui-component-genericity.md` §3）。包 antd `Drawer`，
 * 不另起一套：焦点陷阱、滚动锁、portal、遮罩、Esc 与焦点回位都是它的能力，重写一遍只会漏。
 *
 * 三条写进类型或结构、不靠评审：
 * - `size` 是四档闭集（`narrow` 420 / `large` 640 / `wide` 860 / `full` 1040），**不收 `width`、
 *   不收 `style`、不收 `styles`**；超宽屏上限 `92vw` 也在这里定，调用方不写第二份；
 * - 头部只有两档：`titleKey`（有标题）或 `ariaLabelKey`（无头，但必须有名字）——没有名字的
 *   对话框，读屏只会念「对话框」；
 * - `mode` 只有 `modal` / `inline`，遮罩、Esc、焦点锁定、容器归它决定，不收对应布尔。
 *
 * 关闭控件归组件：`ui.drawer.close` 一条平台键，16 个抽屉共用；调用方不再各画一个，
 * 要加额外动作走 `titleExtra`。
 */

/** 四档，仅此四档。宽度只在下面这张表里出现一次。 */
export const DRAWER_SIZES = ['narrow', 'large', 'wide', 'full'] as const

export type DrawerSize = (typeof DRAWER_SIZES)[number]

const SIZE_PX: Record<DrawerSize, number> = { narrow: 420, large: 640, wide: 860, full: 1040 }

/** 超宽屏上限：档位像素与 92vw 取小。调用方写一份就是两套规则。 */
const VIEWPORT_CAP = '92vw'

export type DrawerMode = 'modal' | 'inline'
export type DrawerSide = 'left' | 'right'

type DrawerBase = {
  open: boolean
  onClose: () => void
  /** 每次调用回答一次「这只抽屉要多宽」。不给默认值。 */
  size: DrawerSize
  /** `modal` 有遮罩、锁焦点、Esc 关；`inline` 无遮罩、不锁焦点、`getContainer={false}`。 */
  mode?: DrawerMode
  /** 只对 `mode="inline"` 有意义：浮层 13 处全部右置，左置只出现在流内面板。 */
  side?: DrawerSide
  /** 全出血内容（预览、编辑器这类自带 chrome 的正文）用 `flush`。 */
  contentPadding?: 'default' | 'flush'
  /** 标题旁的徽标或动作槽，不是自定义整个标题栏的入口。 */
  titleExtra?: ReactNode
  /** 底部动作区；**不传即不渲染**，不是 `footer={null}` 那种开关。 */
  footer?: ReactNode
  children: ReactNode
  className?: string
  resolveText: (key: string) => string
}

/** 头部两档：有标题，或整块不要但必须给读屏名。 */
export type DrawerProps = DrawerBase &
  (
    | {
        header?: 'titled'
        /** 标题的 i18n 键；不收句子。 */
        titleKey: string
      }
    | {
        header: 'none'
        /** 无头抽屉的读屏名；缺了它读屏只会念「对话框」。 */
        ariaLabelKey: string
      }
  )

export function Drawer(props: DrawerProps): ReactElement {
  const { open, onClose, size, mode = 'modal', titleExtra, footer, children, className, resolveText } = props
  const inline = mode === 'inline'
  const headless = props.header === 'none'
  const width = `min(${SIZE_PX[size]}px, ${VIEWPORT_CAP})`
  // 关闭键的读屏名由组件自己的文案表给：调用方的 `resolveText` 可以把未知键解析成空串，
  // 那会让这个按钮没有名字。标题仍由调用方解析，两者不共用一条路径。
  const closeLabel = useDrawerText()()

  const title = headless ? (
      // 无头也要有名字：标题块视觉隐藏，但仍作为 `aria-labelledby` 的落点。
      <span className="drawer__sr-only">{resolveText(props.ariaLabelKey)}</span>
    ) : (
      <span className="drawer__title-row">
        <span className="drawer__title">{resolveText(props.titleKey)}</span>
        {titleExtra === undefined ? null : <span className="drawer__title-extra">{titleExtra}</span>}
      </span>
    )

  return (
    <AntDrawer
      open={open}
      onClose={onClose}
      width={width}
      placement={inline ? (props.side ?? 'right') : 'right'}
      closable={false}
      title={title}
      extra={
        <IconButton
          ariaLabelKey={closeLabel}
          icon={X}
          onSelect={onClose}
          resolveText={(value) => value}
          size="sm"
          variant="plain"
        />
      }
      footer={footer}
      mask={!inline}
      maskClosable={!inline}
      keyboard={!inline}
      {...(inline ? { getContainer: false as const } : {})}
      {...(headless ? { styles: { header: { display: 'none' } } } : {})}
      rootClassName={['drawer', `drawer--${size}`, `drawer--${mode}`, inline ? `drawer--${props.side ?? 'right'}` : '']
        .filter(Boolean)
        .join(' ')}
      className={['drawer__panel', `drawer__panel--${props.contentPadding ?? 'default'}`, className]
        .filter(Boolean)
        .join(' ')}>
      {children}
    </AntDrawer>
  )
}
