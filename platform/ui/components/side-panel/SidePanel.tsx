import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { IconButton } from '../icon-button'
import { fillLabelParams } from '../textKeyParams'
import { PANEL_COLLAPSE_KEY, PANEL_SHOWING_KEY, usePanelText } from './panelText'

import './sidePanel.css'

/**
 * 并排侧面板（形态：`docs-private/05-desktop/ui-audit/side-panel-form-2026-11-02.md`）。
 *
 * 判据：**面板出现时读者还能看到并点到主内容 → `SidePanel`；不能 → `Drawer`**。
 * 所以它没有遮罩、不锁焦点、也不监听全局 Esc——读者本来就该能在两侧之间来回走，
 * 抢走 Esc 会和页面里的 Esc 打架。
 *
 * 骨架期只落已定的部分（契约未定稿的槽位细节一律不碰）：
 * - 两档闭集 `rail` 282 / `flex` min(480px, 46vw)，比例写在组件里，调用点不传数字；
 * - 左置固定，不提供 `side`（仓库三处左置、零处右置）；
 * - 收起键归组件，读屏名走 `panelText` 常量，不经过调用方 `resolveText`；
 * - 宽度不参与过渡（会连续重排主内容），只做一次 opacity 淡入，时长取 `--motion-enter` token
 *   （`reduced-motion` 下该 token 为 0ms）。不写字面量：动画时长是主题的决定，不是组件的决定。
 */

export const SIDE_PANEL_SIZES = ['rail', 'flex'] as const
export type SidePanelSize = (typeof SIDE_PANEL_SIZES)[number]

const SIZE_CSS: Record<SidePanelSize, string> = {
  rail: '282px',
  flex: 'min(480px, 46vw)'
}

/**
 * 焦点策略（契约 §10），两种读者意图：
 * - `move-in`（默认）：读者**按按钮打开**面板——焦点进正文首个可操作项，收起时还回去；
 * - `stay`：读者在列表里选中某项、面板**跟着换内容**——焦点既不进入也不还原。不进入就没有可还原的。
 *
 * 不用布尔：`focusOnOpen?: boolean` 只是开关的另一个名字，说不清读者想干什么。
 */
export type SidePanelFocusPolicy = 'move-in' | 'stay'

type SidePanelFocusShape =
  | {
      focusPolicy?: 'move-in'
      /** `move-in` 不需要内容标识：焦点移动本身就是播报。 */
      contentId?: never
    }
  | {
      focusPolicy: 'stay'
      /**
       * 当前内容的稳定标识。**判重靠它，不靠标题**：日历里同一时段两场「FOMC 会议」很常见，
       * 标题一样、id 不同，按标题判重就会漏播，读屏用户以为没换。
       */
      contentId: string
      /**
       * 播报句里用来区分的那个值（调用方按平台格式化器算好的字符串，如时刻）。
       *
       * **必填**：`stay` 只用于「读者在列表里选」的场景，而那里最容易出现的失败就是
       * 同名两条念出同一句话。做成可选就等于允许忘记，于是又回到「播了两遍同一句」。
       */
      when: string
    }

export type SidePanelProps = SidePanelFocusShape & {
  open: boolean
  /** 收起时调用；键盘收起后焦点回到触发元素，由调用方负责（组件不猜触发器是谁）。 */
  onClose: () => void
  size: SidePanelSize
  /** 标题的 i18n 键；不收句子。 */
  titleKey: string
  /** 底部动作区；**不传即不渲染**。 */
  footer?: ReactNode
  children: ReactNode
  className?: string
  resolveText: (key: string) => string
}

export function SidePanel(props: SidePanelProps): ReactElement | null {
  const { open, onClose, size, titleKey, footer, children, className, resolveText } = props
  const focusPolicy: SidePanelFocusPolicy = props.focusPolicy ?? 'move-in'
  const contentId = props.focusPolicy === 'stay' ? props.contentId : undefined
  const when = props.focusPolicy === 'stay' ? props.when : undefined
  const panelRef = useRef<HTMLElement>(null)
  // 区域名走 aria-labelledby 指向标题节点：再用 aria-label 写同一句，读屏会把标题念两遍。
  const titleId = useId()
  /** 打开前焦点在哪：收起时还回去。谁移动了焦点，谁负责还原。 */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const collapseLabel = usePanelText()()

  // 开：记住原焦点，再把它送进**正文**里第一个可操作项（正文没有才落在收起键上）。
  // 关：把焦点还回去——三个调用点各写一份等于没人写，而键盘用户的位置会掉到 body 上。
  // 不做焦点陷阱：Tab 仍能走回主内容，这是它与 `Drawer` 在键盘上的区别。
  useEffect(() => {
    // `stay` 档：焦点既不进入也不还原——读者正在列表里连着看，抢走焦点等于每点一次被拉走一次。
    if (focusPolicy === 'stay') return
    if (!open) {
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
      return
    }
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement ? active : null
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const body = panelRef.current?.querySelector<HTMLElement>('.side-panel__body')
    const target = body?.querySelector<HTMLElement>(selector) ?? panelRef.current?.querySelector<HTMLElement>(selector)
    target?.focus()
  }, [open, focusPolicy])

  // `stay` 档焦点不动，读屏就收不到「内容变了」；所以由面板自己播一句，只播标题、不播正文。
  // 按 `contentId` 判重（标题只用来播）+ 400ms 去抖：连点三个事件只播最后一个。
  const [announcement, setAnnouncement] = useState('')
  const announcedId = useRef<string | null>(null)
  const showingLabel = usePanelText()(PANEL_SHOWING_KEY)

  // 最新标题放 ref：调用点多半传内联 `resolveText`，父级每渲染一次就是新引用。
  // 把它放进依赖会让计时器被无关渲染反复重启——父页比 400ms 快时，播报一次都不会出现。
  const titleRef = useRef('')
  titleRef.current = resolveText(titleKey)

  useEffect(() => {
    if (!open) {
      // 重开是新的一轮：复位门闩，否则关闭再打开同一条会一声不响。
      announcedId.current = null
      return
    }
    if (focusPolicy !== 'stay' || contentId === undefined) return
    // 判重按 id：同一条内容重渲染不再念一遍。标题只用来播。
    if (announcedId.current === contentId) return
    const timer = setTimeout(() => {
      announcedId.current = contentId
      setAnnouncement(fillLabelParams(showingLabel, { title: titleRef.current, when: when ?? '' }))
    }, 400)
    return () => clearTimeout(timer)
  }, [open, focusPolicy, contentId, when, showingLabel])

  if (!open) return null

  return (
    <aside
      aria-labelledby={titleId}
      className={['side-panel', `side-panel--${size}`, className].filter(Boolean).join(' ')}
      ref={panelRef}
      style={{ '--side-panel-width': SIZE_CSS[size] } as React.CSSProperties}>
      <header className="side-panel__header">
        <h2 className="side-panel__title" id={titleId}>
          {resolveText(titleKey)}
        </h2>
        <IconButton
          ariaLabelKey={PANEL_COLLAPSE_KEY}
          icon={X}
          onSelect={onClose}
          // 收起键的名字是组件常量，不让调用方的解析器有机会把它变成空串。
          resolveText={(key) => (key === PANEL_COLLAPSE_KEY ? collapseLabel : key)}
          size="sm"
        />
      </header>
      {/* 只有 `stay` 挂 live region：`move-in` 的焦点本身就会播报，再挂一层就是念两遍。 */}
      {focusPolicy === 'stay' ? (
        <span aria-live="polite" className="side-panel__status" role="status">
          {announcement}
        </span>
      ) : null}
      <div className="side-panel__body">{children}</div>
      {footer === undefined ? null : <footer className="side-panel__footer">{footer}</footer>}
    </aside>
  )
}
