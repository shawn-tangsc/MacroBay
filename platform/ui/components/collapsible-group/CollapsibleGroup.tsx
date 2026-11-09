import { Collapse } from 'antd'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'
import { ChevronDown } from 'lucide-react'

import { fillLabelParams } from '../textKeyParams'
import { StatusPill, type StatusPillTone } from '../status-pill'

import './collapsibleGroup.css'

/**
 * 可折叠分组（界面设计 2026-11-09 定稿）：**自绘头行与箭头只许出现在这里**。
 *
 * 壳里固定四件事，应用侧不许再各写一套：
 * 1. **箭头在最右**，展开时转 180°；
 * 2. **展开动画**由 antd `Collapse`（`ghost`）提供，不自己补 transition 到高度上；
 * 3. **`aria-expanded` + `aria-controls`** 由底层给出，头行是整行的可聚焦按钮；
 * 4. **整行可点**——点在标题、计数或箭头上都算，不必瞄准一个 14px 的箭头。
 *
 * 三条实现约束：
 * - **多组各自独立**：每组一个 `Collapse`，不做手风琴（`accordion` 会让后开的那组把前一组关掉）；
 * - **默认收起、展开态不持久化**：不进 localStorage、不进 URL——这是视图状态，不是读者设置；
 * - **展开区自己滚**：41 条实数据时头行不许滚走，滚动条只出现在展开区里（`maxBodyHeight` 是那个上限）。
 *
 * 头行：标题**分组档** 11.5/600/muted-strong（`ui-rules` §2：可折叠头与分组标题同类）+
 * 右侧「共 N 条」11/400/muted/tabular-nums + 最右 `ChevronDown` 14。
 * 展开项：标题 12/500 单行省略 + 时间右对齐 11/400/muted/tabular-nums + `StatusPill`；行高 44/60。
 */

/** 展开区自滚的上限（px）。与 `--font-*` 一样是组件自己的决定，不是调用方传的排版参数。 */
export const COLLAPSIBLE_GROUP_BODY_MAX_HEIGHT = 320

const CHEVRON_SIZE = 14

/** 一行展开项。标题与时间都只收键；时间**只出现一次**，由调用方保证不会在标题里再写一遍。 */
export type CollapsibleGroupRow = {
  key: string
  labelKey: string
  metaKey?: string
  metaParams?: Readonly<Record<string, string>>
  status?: { tone: StatusPillTone; labelKey: string }
  /**
   * 整行即动作时传：整行渲染成 `<button>`（行容器规则：只有一个动作 → 整行可点）。
   * 不传就是不可交互的一行文本——**不假点击**：没有动作的行不许长成按钮。
   */
  onSelect?: (key: string) => void
}

/** 两种内容形态共用的那部分。 */
type CollapsibleGroupBaseProps = {
  titleKey: string
  /** 头行右侧的计数（如「共 41 条」），同样只收键；不传就不显示。 */
  metaKey?: string
  metaParams?: Readonly<Record<string, string>>
  resolveText: (key: string) => string
  /** 展开区的自滚上限，默认 `COLLAPSIBLE_GROUP_BODY_MAX_HEIGHT`。 */
  maxBodyHeight?: number
}

/**
 * 两种内容形态，**互斥**：
 * - `rows`：一组行，壳负责行级语义（整行即动作、时间、`StatusPill` 槽）；
 * - `children`：调用方自定义内容（表格、表单、说明块）。**壳只提供行为**：头行档位、箭头、`aria-*`、
 *   整行可点、默认收起、展开区自滚、头行不滚走。**不提供行级语义**——需要「整行可点 + `StatusPill`」
 *   的列表仍用 `rows`；`children` 里内容的可访问性由作者自己负责。
 */
export type CollapsibleGroupProps = CollapsibleGroupBaseProps & (
  | { rows: readonly CollapsibleGroupRow[]; children?: never }
  | { children: ReactNode; rows?: never }
)

export function CollapsibleGroup(props: CollapsibleGroupProps): React.ReactElement {
  const { titleKey, metaKey, metaParams, resolveText, maxBodyHeight = COLLAPSIBLE_GROUP_BODY_MAX_HEIGHT } = props
  const rows = props.rows ?? []
  const title = resolveText(titleKey)
  const meta = metaKey === undefined ? null : fillLabelParams(resolveText(metaKey), metaParams)
  /**
   * `aria-controls` 必须指向**确实存在**的节点：rc-collapse 只给 `aria-expanded`（`Panel.js:53`），
   * 不给 `aria-controls`。所以 id 由这里生成、挂到展开区上，再把 header 指过来。
   *
   * 展开区必须从首帧就存在（`forceRender`）：懒挂载时收起态指向一个不存在的 id，
   * 比不写更糟。41 行是一屏内的文本，渲染成本低于「读屏指了个空 id」。
   */
  const bodyId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    root.querySelector<HTMLElement>('.ant-collapse-header')?.setAttribute('aria-controls', bodyId)
  }, [bodyId])

  return (
    <div ref={rootRef}>
    <Collapse
      className="collapsible-group"
      expandIconPosition="end"
      expandIcon={({ isActive }) => (
        <ChevronDown
          aria-hidden="true"
          className="collapsible-group__chevron"
          data-open={isActive ? 'true' : 'false'}
          size={CHEVRON_SIZE}
          strokeWidth={1.8}
        />
      )}
      ghost
      items={[{
        key: 'group',
        forceRender: true,
        label: (
          <span className="collapsible-group__head">
            <span className="collapsible-group__title" title={title}>{title}</span>
            {meta === null ? null : <span className="collapsible-group__meta">{meta}</span>}
          </span>
        ),
        children: (
          <div className="collapsible-group__body" id={bodyId} style={{ maxHeight: maxBodyHeight }}>
            {props.children !== undefined ? props.children : rows.map((row) => {
              const rowTitle = resolveText(row.labelKey)
              const rowMeta = row.metaKey === undefined ? null : fillLabelParams(resolveText(row.metaKey), row.metaParams)
              const inner = (
                <>
                  <span className="collapsible-group__row-title">{rowTitle}</span>
                  {rowMeta === null ? null : <span className="collapsible-group__row-meta">{rowMeta}</span>}
                  {row.status === undefined ? null : (
                    <StatusPill resolveText={resolveText} tone={row.status.tone} labelKey={row.status.labelKey} />
                  )}
                </>
              )
              // 行容器规则：只有一个动作 ⇒ 整行可点并补可访问名；多个动作 ⇒ 调用方不该把动作塞进这里。
              return row.onSelect === undefined ? (
                <div className="collapsible-group__row" key={row.key}>{inner}</div>
              ) : (
                <button
                  aria-label={rowTitle}
                  className="collapsible-group__row collapsible-group__row--action"
                  key={row.key}
                  onClick={() => row.onSelect?.(row.key)}
                  type="button">
                  {inner}
                </button>
              )
            })}
          </div>
        )
      }]}
    />
    </div>
  )
}
