import { Drawer as AntDrawer } from 'antd'
import { X } from 'lucide-react'
import { useEffect, type ReactElement, type ReactNode } from 'react'

import { IconButton } from '../icon-button'
import { DRAWER_CLOSE_KEY, useDrawerText } from './drawerText'

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
 * `inline` 与 `modal` 在焦点上不是一套规则，这也是这里唯一按模式分叉的行为：
 * - **打开不移动焦点**：流内面板嵌在页面里，读者正在页面上操作，把他拽进面板就是丢位置；
 * - **Esc 在文档层监听**：焦点在页面别处时也要能关——一块嵌在页面流里的面板「按 Esc 没反应」
 *   对任何使用者都不成立；
 * - **关闭不动焦点**：没有进过面板，也就没有「还回去」这回事。
 *
 * 这三条对 `modal` 一条都不适用：浮层必须锁焦点、Esc 归 antd。
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
  /** 全出血内容（预览、编辑器这类自带 chrome 的正文）用 `flush`。 */
  contentPadding?: 'default' | 'flush'
  /** 底部动作区；**不传即不渲染**，不是 `footer={null}` 那种开关。 */
  footer?: ReactNode
  children: ReactNode
  className?: string
  resolveText: (key: string) => string
  /**
   * **生命周期开关**：关闭后是否卸载内容。原样透传给 antd，**不传即 antd 默认**（不加隐式行为）。
   *
   * 判据：改变「内容何时存在」→ 透传；改变「长什么样」→ 进规格。清单见 `drawer.md`。
   */
  destroyOnHidden?: boolean
}

/**
 * 模式必须每次显式回答，`side` 只活在 `inline` 分支里。
 *
 * 原先 `mode` 有默认值、`side` 放在基础类型里，于是 `<Drawer mode="modal" side="left" />` 能编译，
 * 运行时 `placement` 却被固定成 `right`——传了却被**静默丢掉**。静默不生效比编译不过贵得多。
 */
type DrawerModeShape =
  | { mode: 'modal' }
  | {
      mode: 'inline'
      /** 左置只出现在流内面板；浮层一律右置。 */
      side?: DrawerSide
    }

/**
 * 头部两档：有标题，或整块不要但必须给读屏名。
 * `titleExtra` 只挂有标题那一档——无头抽屉没有标题行，传了也画不出来。
 */
type DrawerHeaderShape =
  | {
      header?: 'titled'
      /** 标题的 i18n 键；不收句子。 */
      titleKey: string
      /** 标题旁的徽标或动作槽，不是自定义整个标题栏的入口。 */
      titleExtra?: ReactNode
    }
  | {
      header: 'none'
      /** 无头抽屉的读屏名；缺了它读屏只会念「对话框」。 */
      ariaLabelKey: string
    }

export type DrawerProps = DrawerBase & DrawerModeShape & DrawerHeaderShape

export function Drawer(props: DrawerProps): ReactElement {
  const { open, onClose, size, footer, children, className, resolveText, destroyOnHidden } = props
  const inline = props.mode === 'inline'
  const headless = props.header === 'none'
  const width = `min(${SIZE_PX[size]}px, ${VIEWPORT_CAP})`
  // 关闭键的读屏名由组件自己的文案表给：调用方的 `resolveText` 可以把未知键解析成空串，
  // 那会让这个按钮没有名字。标题仍由调用方解析，两者不共用一条路径。
  const closeLabel = useDrawerText()()

  // 流内面板的 Esc：焦点不在面板里也要能关，所以监听落在 document 上（仅在打开期间）。
  useEffect(() => {
    if (!inline || !open) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [inline, open, onClose])

  const title = headless ? (
      // 无头也要有名字：标题块视觉隐藏，但仍作为 `aria-labelledby` 的落点。
      <span className="drawer__sr-only">{resolveText(props.ariaLabelKey)}</span>
    ) : (
      <span className="drawer__title-row">
        <span className="drawer__title">{resolveText(props.titleKey)}</span>
        {props.titleExtra === undefined ? null : <span className="drawer__title-extra">{props.titleExtra}</span>}
      </span>
    )

  return (
    <AntDrawer
      open={open}
      onClose={onClose}
      width={width}
      placement={props.mode === 'inline' ? (props.side ?? 'right') : 'right'}
      closable={false}
      title={title}
      extra={
        <IconButton
          ariaLabelKey={DRAWER_CLOSE_KEY}
          icon={X}
          onSelect={onClose}
          // 组件之间也只传键：IconButton 拿键、我们的 resolver 把这一条映射成句子。
          resolveText={(value) => (value === DRAWER_CLOSE_KEY ? closeLabel : value)}
          size="sm"
          variant="plain"
        />
      }
      footer={footer}
      {...(destroyOnHidden === undefined ? {} : { destroyOnHidden })}
      mask={!inline}
      maskClosable={!inline}
      keyboard={!inline}
      // 流内面板不抢焦点；浮层保持 antd 默认（锁焦点、Esc 归它）。
      {...(inline ? { autoFocus: false, getContainer: false as const } : {})}
      {...(headless ? { styles: { header: { display: 'none' } } } : {})}
      rootClassName={['drawer', `drawer--${size}`, `drawer--${props.mode}`, inline ? `drawer--${props.side ?? 'right'}` : '']
        .filter(Boolean)
        .join(' ')}
      className={['drawer__panel', `drawer__panel--${props.contentPadding ?? 'default'}`, className]
        .filter(Boolean)
        .join(' ')}>
      {children}
    </AntDrawer>
  )
}
