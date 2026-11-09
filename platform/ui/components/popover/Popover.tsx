import { Popover as AntPopover } from 'antd'
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode
} from 'react'

import { fillLabelParams } from '../textKeyParams'
import { overlayContainer } from '../overlayContainer'
import './popover.css'

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
 * **锚点由浮层自己拿**（2026-11-02）：触发器被包进一个 `span.platform-popover__anchor`，浮层量的是
 * 这个真实节点，不指望调用方或子组件转发 `ref`。早先直接拿子元素当锚点，子组件没有转发 ref 时
 * （`IconButton` 当时就是），浮层拿不到矩形，按 (0,0) 定位——气泡要么不出现，要么停在窗口左上角。
 * 靠“每个触发器都记得转发 ref”是隐式约定；把它变成浮层自己的责任，调用点不必再懂这件事。
 *
 * 点击别处关闭时**不抢焦点**：读者点的那个地方就是他要去的地方，焦点跟着他走。
 *
 * 为什么不用 antd 的 `trigger` 列表而要自己管开合：`['hover','focus','click']` 三件一起给，
 * 鼠标移开就关，**钉不住**；只在「读者自己点了」的时候钉住，需要一个别人不知道的状态。
 */

/**
 * 胶囊上限（契约 §8 / 界面设计 2026-11-02）：宽 ≤ 360、高 ≤ 320，超了在框内滚动。
 *
 * 这两个数**写在组件里、由守卫读源码校验**，不是文档口径：文档里的上限没有守门人，
 * 而「气泡长到盖住半张图」正是今天在永续卡上刚演过一遍的事故。
 * 高必须靠 `maxHeight + overflow:auto` 兜，不能靠调用方少写两句——提醒不守的门等于没有门。
 */
const MAX_WIDTH = 360
const MAX_HEIGHT = 320
const PLACEMENT = 'bottom' as const

/**
 * 气泡不接受指针事件：鼠标移上去、点下去都穿到下面的控件上。
 *
 * 与 `Tooltip` 同一条理由、同一处实现：气泡是**说明**，不是控件，它挡住下面的东西，读者反而点不动
 * 本来要点的。只给一个节点不够——antd 把浮层渲染成外层与内层两个元素，漏一个另一个仍会接住点击。
 */
const BUBBLE_POINTER_EVENTS = { pointerEvents: 'none' } as const

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
      content?: undefined
    }
  | {
      labelKey?: undefined
      labelParams?: never
      lines: readonly PopoverLine<K>[]
      content?: undefined
    }
  | {
      labelKey?: undefined
      labelParams?: never
      lines?: undefined
      /**
       * 调用方拼好的节点：原样放进浮层内容区，组件不解析、不加样式、不知道里面是什么。
       *
       * 为什么需要这一支：有些说明由多项组成，其中若干片段可以缺失，用键模板拼会留下空括号
       * （「来源 · （）· 每 30 分钟」）。哪些片段能缺只有调用方知道，所以拼装留在调用方；
       * 组件只提供一个**纯泛型槽**，槽里出现业务词汇就是越界。
       */
      content: ReactNode
    }

export type PopoverProps<K extends string = string> = PopoverText<K> & {
  /**
   * 触发器：交出属性、由调用方自己渲染那个可聚焦控件。
   * 不接受裸 children——那会退回「注入处理器」的老路，两个平台组件就又能互相咬住。
   */
  trigger: (props: PopoverTriggerProps) => ReactElement
} & (
  | {
      /** 调用方的文案解析入口；未知键返回空串时整块浮层不渲染。`content` 分支不需要它。 */
      resolveText: (key: K) => string
      content?: undefined
    }
  | {
      resolveText?: never
      content: ReactNode
    }
)

export function Popover<K extends string = string>(props: PopoverProps<K>): ReactElement {
  const resolveText = props.resolveText
  // 多行只来自**键数组**，不来自 `\n` 折行：换行属于排版巧合，翻译会被合并或吃掉，而首行强调只有数组能表达。
  // 逐行解析、逐行填占位符：每行的参数各管各的，空行丢弃（原行为不变）。
  const entries: ReadonlyArray<{ key: K; params?: Readonly<Record<string, string>> }> =
    props.lines !== undefined
      ? props.lines.map((line) => ({ key: line.labelKey, params: line.params }))
      : props.labelKey === undefined
        ? []
        : [{ key: props.labelKey, params: props.labelParams }]
  const resolvedLines = resolveText === undefined
    ? []
    : entries
        .map((entry) => fillLabelParams(resolveText(entry.key), entry.params))
        .filter((line) => line.trim() !== '')
  const [pinned, setPinned] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const trigger = useRef<HTMLElement | null>(null)
  /**
   * 浮层的 id：`aria-describedby` 要指向**确实存在**的节点，所以 id 由组件生成、挂在内容上，
   * 再让触发器指过来。调用方不用传 id——它不该知道浮层节点长什么样。
   *
   * 触发器是调用方的 render prop，只能靠 clone 把属性挂上去；`IconButton` 因此要能转发这一条
   * （与 `onClick` 那批同一个道理：注进去的属性被静默丢掉，等于没挂）。
   */
  const contentId = useId()
  const content = useRef<HTMLDivElement | null>(null)
  const open = pinned || hovered || focused

  // 内容只有两个来处：调用方拼好的节点，或由键解析出的句子（类型上两者互斥）。
  // 没有内容就不存在浮层：空框比没有框更糟，键名更糟。
  const hasContentSlot = props.content !== undefined
  // 给了槽但这一帧是空值（`null` / `false` / 空串）：那是调用方的条件渲染，不是「文案没写」的缺陷，
  // 也不画空框。空串必须一起算：`''` 是合法 ReactNode，漏掉它就会渲染出一个空气泡。
  const contentPresent = hasContentSlot
    && props.content !== null
    && props.content !== false
    && props.content !== ''
  const resolved = hasContentSlot ? contentPresent : resolvedLines.length > 0

  const close = (): void => {
    setPinned(false)
    setHovered(false)
    setFocused(false)
  }

  // Esc 关闭，焦点回到触发器。只在开着的时候挂监听。
  //
  // **只关浮层，不关它所在的面板**：设置抽屉、弹窗自己也监听 Esc，一次按键会被两层同时处理。
  // 真窗口实测（2026-11-03，`5fd4737` 那台）：浮层开着时按 Esc，浮层关了、设置面板也一起关了，
  // 焦点落回页面上那颗「生成设置」——读者按的是「关掉这段说明」，丢的却是「刚才那个设置页」。
  // 所以在**捕获阶段**拦下来：注册在同一 document 上的外层处理器（冒泡）收不到这次按键。
  // 浮层没开时不注册监听，Esc 照常传给外层，不会一直吞键。
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
      trigger.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
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

  // 缺文案是**缺陷**，不是一种运行态（产品经理 + 架构师 2026-11-02 定）。
  if (!resolved) {
    // 槽给了、这一帧是空的：调用方的条件渲染，不是缺文案——静默不画，也不抛。
    if (hasContentSlot) return <>{null}</>
    if (import.meta.env.DEV) {
      // 开发期当场炸：键不存在、解析成空串、解析器把键名原样吐回来，都算「这句话没写」。
      // 生产期不抛——顶栏不该因为一句文案崩掉；那时**连触发器一起不渲染**（见下）。
      throw new Error(
        'Popover has no copy: the key resolved to an empty sentence. Fix the copy, do not hide the defect with interaction.'
      )
    }
    // 生产期：触发器与浮层都不出现。留一个点了没反应的按钮，正是这些天在清的假控件。
    return <>{null}</>
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
      getPopupContainer={overlayContainer}
      content={
        <div
          className="platform-popover__content"
          data-popover-content
          id={contentId}
          ref={content}
          style={{ maxHeight: MAX_HEIGHT, maxWidth: MAX_WIDTH }}>
          {hasContentSlot ? props.content : resolvedLines.map((line, index) => (
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
      styles={{ root: BUBBLE_POINTER_EVENTS, body: BUBBLE_POINTER_EVENTS }}
      trigger={[]}>
      <span className="platform-popover__anchor">
        {cloneElement(props.trigger(triggerProps) as ReactElement<{ 'aria-describedby'?: string }>, {
          'aria-describedby': contentId
        })}
      </span>
    </AntPopover>
  )
}
