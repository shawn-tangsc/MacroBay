import { Popover as AntPopover } from 'antd'
import {
  useEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'

import { fillLabelParams } from '../textKeyParams'

/**
 * 多行说明浮层（界面设计 2026-11-02 定的五条能力）。
 *
 * 与 `Tooltip` 的分工：`Tooltip` 只放一行帮助句，读者扫一眼就走；需要**读一段**、
 * 需要**钉住对照**、或者有 3 行以上说明的，用这里。两者都只收键——句子由调用方解析，
 * 组件内零文案零 i18n。
 *
 * 五条能力写进行为与用例，不靠评审：
 * 1. **悬停与聚焦都触发**：读者用 Tab 指过来就该看到，不用鼠标去碰；
 * 2. **点击触发器钉住**，再点别处或按 Esc 关闭——钉住是为了边看边对照，只靠悬停撑不住；
 * 3. **有最大宽度**，长说明换行，不把页面撑开；
 * 4. **定位跟随触发器、不遮住被说明的内容**：在下方，空间不足时向上翻；定位与翻转交给 antd，
 *    本组件不自己算坐标（同 `Tooltip` 的理由）；
 * 5. **Esc 关闭后焦点回到触发器**：不然焦点掉到 `body`，键盘读者就丢了位置。
 *
 * 点击别处关闭时**不抢焦点**：读者点的那个地方就是他要去的地方，焦点跟着他走。
 *
 * 为什么不用 antd 的 `trigger` 列表而要自己管开合：`['hover','focus','click']` 三件一起给，
 * 鼠标移开就关，**钉不住**；只在「读者自己点了」的时候钉住，需要一个别人不知道的状态。
 */

const MAX_WIDTH = 320
const PLACEMENT = 'bottom' as const

/**
 * 浮层交给触发器的那组属性。
 *
 * **不再 `cloneElement` 往子组件里注入处理器**：那是「子组件必须愿意交出自己已绑的事件」的隐式约定，
 * 子组件一旦自己绑了 onClick（`IconButton` 就是这样），双方就合成不了——持仓卡那颗「?」卡了整整一晚。
 * 现在由调用方显式把属性摊到自己的触发器上：点击入口叫 `onSelect`（与 `IconButton` 同名），
 * 普通元素使用处写 `onClick={p.onSelect}`。
 */
export type PopoverTriggerProps = {
  /** 点击：钉住 / 再点一次关闭。 */
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void
  onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => void
  onMouseLeave: (event: ReactMouseEvent<HTMLElement>) => void
  onFocus: (event: ReactFocusEvent<HTMLElement>) => void
  onBlur: (event: ReactFocusEvent<HTMLElement>) => void
  /** 展开态：`IconButton` 的 `expanded` 直接用；普通元素用 `aria-expanded`。 */
  expanded: boolean
}

/** 一行说明：键 + 这一行自己的参数（已格式化好的字符串）。 */
export type PopoverLine<K extends string = string> = {
  labelKey: K
  params?: Readonly<Record<string, string>>
}

/**
 * 文案的两种形状（契约 §8）：一句话（`labelKey`），或一段分行的说明（`lines`）。
 *
 * 写成联合而不是「两个都可选」：调用点必须给至少一个，少给是编译错误，
 * 而不是渲染出一个空浮层——空框比没有框更糟，这一点和 `resolveText` 返回空串时整块不渲染是同一条。
 *
 * `labelParams` 只在单行分支存在：多行分支把它写成 `never`，因为「整块共用一份参数」和
 * 「每行自带参数」长期并存，又会变成同一个概念两种写法。多行的参数进 `lines[].params`。
 */
export type PopoverText<K extends string = string> =
  | {
      labelKey: K
      /** 要填进模板的数字或名词，**只收已经格式化好的字符串**（`10–2`、`289/289`）。 */
      labelParams?: Readonly<Record<string, string>>
      lines?: undefined
    }
  | {
      labelKey?: undefined
      labelParams?: never
      lines: readonly PopoverLine<K>[]
    }

export type PopoverProps<K extends string = string> = PopoverText<K> & {
  /** 调用方的文案解析入口；未知键返回空串时整块浮层不渲染。 */
  resolveText: (key: K) => string
  /**
   * 触发器：交出属性、由调用方自己渲染那个可聚焦控件。
   * 不接受裸 children——那会退回「注入处理器」的老路，两个平台组件就又能互相咬住。
   */
  trigger: (props: PopoverTriggerProps) => ReactElement
}

export function Popover<K extends string = string>(props: PopoverProps<K>): ReactElement {
  const { resolveText } = props
  // 多行只来自**键数组**，不来自 `\n` 折行：换行属于排版巧合，翻译会被合并或吃掉，而首行强调只有数组能表达。
  // 逐行解析、逐行填占位符：每行的参数各管各的，空行丢弃（原行为不变）。
  const entries: ReadonlyArray<{ key: K; params?: Readonly<Record<string, string>> }> =
    props.lines !== undefined
      ? props.lines.map((line) => ({ key: line.labelKey, params: line.params }))
      : props.labelKey === undefined
        ? []
        : [{ key: props.labelKey, params: props.labelParams }]
  const resolvedLines = entries
    .map((entry) => fillLabelParams(resolveText(entry.key), entry.params))
    .filter((line) => line.trim() !== '')
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement | null>(null)
  const open = pinned || hovered || focused

  // 没有句子就不存在浮层：空框比没有框更糟，键名更糟。
  const resolved = resolvedLines.length > 0

  const close = (): void => {
    setPinned(false)
    setHovered(false)
    setFocused(false)
  }

  // Esc 关闭，焦点回到触发器。只在开着的时候挂监听。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      close()
      trigger.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // 点别处关闭。点进浮层自己不算别处（长说明里将来放链接也一样）。
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (trigger.current?.contains(target) === true) return
      if (content.current?.contains(target) === true) return
      close()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  // 没有句子就没有浮层，但**触发器还在**：调用方给的是一个真实控件（按钮），把按钮一起拿掉
  // 等于从页面上删掉一个东西——那是它们没要求的事。这里只让触发器什么都不做。
  if (!resolved) {
    return props.trigger({ onSelect: () => undefined, onMouseEnter: () => undefined, onMouseLeave: () => undefined, onFocus: () => undefined, onBlur: () => undefined, expanded: false })
  }

  const triggerProps: PopoverTriggerProps = {
    onSelect: (event) => {
      trigger.current = event.currentTarget
      setPinned((previous) => !previous)
    },
    onMouseEnter: (event) => {
      trigger.current = event.currentTarget
      setHovered(true)
    },
    onMouseLeave: () => setHovered(false),
    onFocus: (event) => {
      trigger.current = event.currentTarget
      setFocused(true)
    },
    onBlur: () => setFocused(false),
    expanded: open
  }

  return (
    <AntPopover
      content={
        <div
          className="platform-popover__content"
          data-popover-content
          ref={content}
          style={{ maxWidth: MAX_WIDTH }}>
          {resolvedLines.map((line, index) => (
            <p
              // 文案是纯数据、顺序固定，没有稳定 id 可用，按位置当键是这里唯一诚实的做法。
              key={index}
              className="platform-popover__line"
              data-popover-line={index}
              // 首行是这句说明的主题，其余是细节：它必须一眼看得出来，否则读者会把同级并列读成同一件事。
              style={index === 0 ? { fontWeight: 600 } : undefined}>
              {line}
            </p>
          ))}
        </div>
      }
      open={open}
      placement={PLACEMENT}
      trigger={[]}>
      {props.trigger(triggerProps)}
    </AntPopover>
  )
}
