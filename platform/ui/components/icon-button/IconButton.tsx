import { Button } from 'antd'
import { fillLabelParams } from '../textKeyParams'

import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, FocusEvent, MouseEvent, ReactElement, Ref } from 'react'

import { LoadingSpinner } from '../loading'
import { Tooltip } from '../tooltip'

import './iconButton.css'

/**
 * 图标触发器（规格：`docs-private/05-desktop/ui-audit/prototypes/2026-11-01-1b-stateview-iconbutton-statuspill.html` ②）。
 *
 * 只做「一个图标 + 一个读屏名」的按钮：问号、关闭、更多、刷新。样式、尺寸、焦点环在这里收口，
 * 各处不再手写 `<button class="...">`——这正是尺寸 18/20/26 与「outline:none 无替代」的来源。
 *
 * 四条写进类型、不靠评审：
 * - `size` 只有 `sm`（22）/ `md`（24）两档；`18 | 20 | 26` 编译不过，不是「约定不要用」；
 * - 读屏名必填且**只收键**（`ariaLabelKey`），句子由调用方注入的 `resolveText` 解析——
 *   组件内零文案零 i18n；键的形状（点分、无空白、无中文）由守卫测试扫源码钉住；
 * - 图标按 lucide 组件传入，组件内包一层 `aria-hidden`：装饰图形不进可访问树，
 *   也挡掉「拿一句中文当图标」这种既不是图标又绕过 i18n 的写法；
 * - 禁用与提示不能并存：禁用的按钮接不到 focus，Tooltip 的 `focus` 触发器就永远不响。
 *
 * 尺寸写进行内 `style` 而不是 CSS class：验收要量出「正好 22 / 24」，而测试环境下读不到
 * 外部样式表（`getComputedStyle` 返回空串），行内值才是可断言的确定值。尺寸词与
 * `StateView` 的 `sm` / `md` 是同一套词，像素值只在这张表里出现一次。
 */

/**
 * 两档，仅此两档。
 *
 * 词与 `StateSize` 的那两档同名，但**故意不是同一个类型**：`StateSize` 还有 `lg`，直接 import
 * 它就会让 `size="lg"` 编译通过，而这颗按钮没有第三档。**同一个词、不同的合法集合，就该是两个
 * 类型**——共用类型是两件事被绑在一起的第一步，之后每一次加档都要问另一方同不同意。
 *
 * **子集方向也是危险的，别只看“两套类型”就放心**：
 *
 * ```
 * IconButtonSize = 'sm' | 'md'        StateSize = 'sm' | 'md' | 'lg'
 * IconButtonSize 是 StateSize 的子集
 *   父集 → 子集   编译不过   （安全）
 *   子集 → 父集   编译通过   （危险）
 * ```
 *
 * 现在是危险方向：把 `IconButton` 的 size 直接透传给一个收 `StateSize` 的组件，会得到一次
 * 「看着合理、类型也对」的传参。所以这两档**可以**传给 `StateView`，反过来不行——加档时两边
 * 要一起看，别只改一边。
 */
export const ICON_BUTTON_SIZES = ['sm', 'md'] as const

export type IconButtonSize = (typeof ICON_BUTTON_SIZES)[number]

/** 档位到像素：行内 22、卡片头与工具栏 24（规格 ②）。 */
const SIZE_PX: Record<IconButtonSize, number> = { sm: 22, md: 24 }

/** 图形按档位缩放：行内档 14、工具栏档 16。 */
const GLYPH_PX: Record<IconButtonSize, number> = { sm: 14, md: 16 }

/**
 * 只放 `data-*` 键进 DOM；**违约当场抛错，不静默过滤**。
 *
 * 这个 prop 只有我们自己的代码在传，传错的唯一可能是写错或强行 cast——而那正是最该在挂载那
 * 一瞬间炸掉的时刻。悄悄丢掉一个键会让「我明明传了却没生效」变成一次排查；而它若放过一个
 * 伪装成属性的尺寸，就等于从内部绕开了 22/24 的闭集。
 */
function dataOnly(
  dataAttributes: Readonly<Record<`data-${string}`, string | number | boolean | undefined>> | undefined
): Record<string, string | number | boolean | undefined> {
  if (dataAttributes === undefined) return {}
  for (const key of Object.keys(dataAttributes)) {
    if (!key.startsWith('data-')) {
      // 面向实现者的错误，不是给读者看的文案：组件里不许出现可见中文（守卫扫源码），所以用英文。
      throw new Error(`IconButton dataAttributes accepts only data-* keys; received "${key}"`)
    }
  }
  return dataAttributes
}

/** 工具栏那一排需要一点底色才不被当成正文，规格里叫 `solid`。 */
/**
 * 三档外观（界面设计 2026-11-02 定档）：
 * - `plain` 透明，行内默认；
 * - `solid` 工具栏那一排，浅底加边框；
 * - `overlay` **绝对定位挂在内容之上**的浮层按钮（分离页窗的回停靠按钮就是它）。
 *   它必须有底：透明意味着「能不能看见取决于下面是什么」，而这类按钮下面永远是任意的图和字。
 */
export type IconButtonVariant = 'plain' | 'solid' | 'overlay'

/**
 * 语义色调（闭集，先只有 `danger`）。与 `StatusPill` 的 tone 是同一个概念，**但不是同一个类型**：
 * 那颗徽标有 success / warning 等档，这颗按钮一个都不收——按钮只在「这一下是破坏性的」时才上色。
 *
 * - **只影响颜色，不碰尺寸与档位**：尺寸仍只有 `sm`/`md`，`plain`/`solid`/`overlay` 与它并存；
 * - **危险色必须静止可见**：默认态就是红字（描边档再给红边），不靠 hover 才出现——
 *   靠悬停才变红的破坏性动作，在键盘与触屏上等于没有提示。
 */
export type IconButtonTone = 'danger'

/** `aria-haspopup` 的合法值。闭集，不收 `string`：写错的值读屏直接忽略。 */
export type IconButtonHasPopup = 'menu' | 'listbox' | 'dialog' | 'tree' | 'grid'



type IconButtonCommon = {
  /**
   * 读屏名的 i18n 键；不收字面量，也不收已解析好的句子。
   *
   * 开区间是有意的：每个站点的读屏名都不同，平台枚举不出来，硬收成闭集只会逼产品绕过它。
   * 代价是「必填的键」只能在守卫侧保证——`iconButtonKeyGuard.test.ts` 扫源码，含空白或中文即红。
   */
  ariaLabelKey: string
  /**
   * 读屏名里的实体名（事件名、来源名、模型名）。**句子的骨架在文案表里，这里只放会变的那几个字。**
   *
   * 不收整句：`{ name: '在日历中打开 CPI' }` 等于把读屏名重新变成七八种说法，
   * 而那正是收键要防的。模板里缺哪个参数就**原样留下 `{name}`**——看得见才会被修，
   * 静默删掉整段会得到一句读得通、但指错对象的话。
   */
  ariaLabelParams?: Readonly<Record<string, string>>
  /** 图标组件（lucide）。装饰图形，本组件负责 `aria-hidden`。 */
  icon: LucideIcon
  /** `sm` = 行内（22），`md` = 卡片头与工具栏（24）。 */
  size: IconButtonSize
  /**
   * 点击回调，**带原生鼠标事件**。
   *
   * 必须带：图标按钮大量出现在可点击的行里（日历事件行、舆情行、供应商行），行本身有选中/打开行为。
   * 不给事件，调用方就没法 `event.stopPropagation()`，点一次图标会连带触发整行——按钮自己反而成了
   * 「顺手做了别的事」。写成必填参数而不是可选：可选会让新站点继续忘记它，而忽略实参的老处理器
   * 照样能编译（多给一个实参不会影响零参函数），所以这条对存量是无痛的。
   */
  onSelect: (event: MouseEvent<HTMLElement>) => void
  /**
   * 正在等待这次点击的结果。为真时按钮 `disabled`、图形换成平台唯一的转圈，并且**不再触发 `onSelect`**。
   *
   * 它不是第三个尺寸，也不是新变体：尺寸仍是 `sm`/`md`，读屏名仍在——用户要知道「哪个按钮在忙」。
   * 产品不要自己再包一层转圈，那会在同一个位置上出现两个 spinner。
   */
  loading?: boolean
  /**
   * 不可点。走原生 `disabled`：离开 Tab 序列、点了不触发。
   *
   * 收 `boolean` 而不是 `true | false` 的字面量联合：调用点几乎都是传一个条件
   * （`disabled={row.busy}`），`boolean` 收敛不到任何一个分支，做成联合只会把无辜站点弄红。
   */
  disabled?: boolean
  /** 默认无边框透明底；工具栏用 `solid`。 */
  variant?: IconButtonVariant
  /**
   * 语义色调。不传就与现在逐字一致（没有任何颜色类进 DOM）。
   *
   * 与 `ariaLabelKey`、`plain` 都不冲突：读屏名照旧必填，档位照旧由 `variant` 决定，
   * tone 只回答「这一下危不危险」。
   */
  tone?: IconButtonTone
  /**
   * 这是不是个「展开/收起」触发器（通知铃铛、折叠面板、抽屉入口）。
   *
   * 只影响可访问性：映射到 `aria-expanded`，读屏用户才知道抽屉现在开着还是关着。
   * 视觉、尺寸、tone 一律不动。**不传时输出里没有这个属性**——不能出现 `aria-expanded="undefined"`。
   */
  expanded?: boolean
  /**
   * 被展开区域的 `id`，映射到 `aria-controls`。与 `expanded` 一样：不传就不输出。
   * 只在确实能指向一个元素时传；指向不存在的 id 比不写更糟。
   */
  controls?: string
  /**
   * 这是不是一个「开关」按钮（当前已按下 / 已开启）。
   *
   * 只影响可访问性：映射到 `aria-pressed`，不传时输出里没有这个属性。
   * **外观不动**——按下态由图标本身或它控制的面板表达；这里不新增第三套按下样式。
   * 读屏名保持恒定（`ariaLabelKey` 不随状态改），否则读屏会听到「隐藏 X，已按下」：
   * 状态说两遍，其中一遍还是错的。
   */
  pressed?: boolean
  /**
   * 这是不是一颗**弹出触发器**（下拉菜单、列出列表、对话框、树、网格）。
   *
   * 只影响可访问性：映射到 `aria-haspopup`，取值是闭集——写错的值读屏会忽略，**静默失效**，
   * 所以这里不收 `string`。
   *
   * **必须与 `expanded` 成对**：只有 `aria-haspopup` 而没有被展开状态，读屏听到的是
   * 「这是个弹出按钮」，但听不出它现在开没开——半套无障碍比没有更容易让人误判。
   *
   * **为什么配对约束在运行时、不在类型上**（实测过才这么写）：把它写成
   * `{ hasPopup?: never; expanded?: boolean } | { hasPopup: …; expanded: boolean }` 这样的联合，
   * 会让 `hasPopup` 成为可辨识键，而存量的三处调用点传的是 `disabled={someBoolean}`——
   * **`boolean` 收敛不到 `disabled?: false` / `disabled: true` 任何一个分支**，于是三个
   * 与本次无关的站点当场报「缺少 hasPopup 与 expanded」。类型能管住这条规则，代价是把
   * 三个无辜站点弄红；那不是管住，那是误伤。
   *
   * 所以：**闭集留在类型上**（写错的值读屏会忽略），**配对关系落成开发期抛错**（见实现），
   * 并配一条用例。与 `dataAttributes` 同款——类型写对不代表属性出现，所以 DOM 断言也留着。
   */
  hasPopup?: IconButtonHasPopup
  /**
   * 调用方自己的类名：**只用来加定位与状态类，不碰尺寸与外观**。
   *
   * 为什么安全：组件的尺寸写在行内 `style`，**行内样式优先于任何类规则**，所以这里加
   * `position/top/right` 改不动 22/24；而让调用方各写一个 wrapper 去定位，等于把测试与样式
   * 都改指外层，问题只是搬了个位置。
   */
  className?: string
  /**
   * 透传的定位样式。**尺寸永远由组件最后写**（`{ ...style, width, height }`），所以这里给不出
   * 覆盖 22/24 的机会——`size` 的闭集不因此松动。
   */
  style?: CSSProperties
  /**
   * 测试钩子与状态属性（`data-redock-tab`、`data-model-chip` 这类）。只收 `data-*` 键。
   *
   * 用独立 prop 而不是让 `<IconButton data-x>` 直传：后者要靠索引签名放宽类型，那会让任何
   * 未知属性都能混进来，包括 `width`。
   *
   * **键必须真的以 `data-` 开头**：类型能被 cast 绕开，而这是调用方唯一能在 DOM 上留痕的口子，
   * 口子小才好查。不在这个前缀下的键**丢弃**，不往 DOM 上写——宁可少一个钩子，也不要一个
   * 伪装成属性的尺寸，那会让 22/24 的闭集从内部被绕过。
   */
  dataAttributes?: Readonly<Record<`data-${string}`, string | number | boolean | undefined>>
  /**
   * 标准交互事件：**浮层类组件的触发器**要用它们（`Popover` 的 render-prop 交出来的就是这一组）。
   *
   * 为什么必须在这里收：`Popover` 早先用 `cloneElement` 往子组件注入 `onMouseEnter` 等处理器，
   * 而 `IconButton` 只绑了自己的 `onSelect`，注进来的处理器被丢掉——两个平台组件因此组合不成一个
   * 触发器（持仓卡那颗「?」就是卡在这里）。透传的是**标准 DOM 交互**，不是让人改外观；
   * `className` / `style` 的边界不因此松动。
   */
  onClick?: (event: MouseEvent<HTMLElement>) => void
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
  /**
   * 真实按钮节点。浮层类组件（`Popover`、`Tooltip`）靠它量锚点矩形来定位。
   *
   * 不转发会静默退化：浮层还是“打开”了，但拿不到矩形，于是按 (0,0) 算位置——气泡要么不出现，
   * 要么停在窗口左上角。2026-11-02 用户报的就是这个症状，所以这里收下并交给底层按钮。
   */
  ref?: Ref<HTMLButtonElement | HTMLAnchorElement>
  /**
   * 可访问描述（`aria-describedby`）。**由浮层类组件注入**（`Popover` 克隆触发器时挂上来）：
   * 读屏先念名字、再念说明。不传就不输出——不能出现 `aria-describedby="undefined"`。
   */
  'aria-describedby'?: string
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传键回显）。 */
  resolveText: (key: string) => string
}

export type IconButtonProps = IconButtonCommon & {
  /**
   * 需要解释时配可聚焦 Tooltip（不用原生 `title`），文案同样只收键。
   *
   * **禁用态不许配提示**：禁用的控件接不到焦点，Tooltip 的 `focus` 触发器永远不响，键盘用户
   * 就只剩一个没有理由的灰按钮。这条与 `hasPopup` / `expanded` 同一个道理，约束落在运行时
   * （见实现）而不是判别联合上：存量的站点传的是 `disabled={someBoolean}`，`boolean` 收敛不到
   * `disabled: true` 分支，做成类型会把无关站点一起弄红——那是误伤，不是管住。
   */
  tooltipKey?: string
}

export function IconButton({
  ariaLabelKey,
  ariaLabelParams,
  icon: Glyph,
  size,
  onSelect,
  disabled,
  loading,
  tooltipKey,
  variant = 'plain',
  tone,
  expanded,
  controls,
  pressed,
  hasPopup,
  className,
  style,
  dataAttributes,
  'aria-describedby': ariaDescribedBy,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  ref,
  resolveText
}: IconButtonProps): ReactElement {
  // 配对关系落在运行时：读屏听到「这是弹出按钮」却听不出开没开，比没写更糟。
  // 面向实现者的错误，所以用英文（组件里不许出现可见中文，守卫扫源码）。
  // 同一条道理：禁用态接不到焦点，Tooltip 只剩鼠标能看，键盘用户拿不到那条原因。
  if (disabled === true && tooltipKey !== undefined) {
    throw new Error(
      'IconButton cannot carry tooltipKey while disabled: a disabled control cannot take focus, so the hint would only be reachable with a mouse'
    )
  }
  if (hasPopup !== undefined && expanded === undefined) {
    throw new Error('IconButton hasPopup requires expanded: a popup trigger must say whether it is open')
  }
  // 一颗按钮要么是开关（按下/未按下），要么是弹出触发器（开着/关着）。两个同时给，
  // 读屏会得到两句互相矛盾的描述——而那种矛盾在界面上完全看不出来。
  if (hasPopup !== undefined && pressed !== undefined) {
    throw new Error('IconButton takes either pressed or hasPopup, not both')
  }
  const ariaLabel = fillLabelParams(resolveText(ariaLabelKey), ariaLabelParams)
  const pixels = SIZE_PX[size]
  const tooltipText = tooltipKey === undefined ? undefined : resolveText(tooltipKey)

  // 底子是 antd `Button`：键盘、禁用、`type="button"` 这些行为不该由我们重写一遍。
  // 尺寸、圆角、焦点环仍是我们的规格，写在行内与本地 CSS 里；外观覆盖清单见文档。
  const button = (
    <Button
      ref={ref}
      aria-label={ariaLabel}
      {...(ariaDescribedBy === undefined ? {} : { 'aria-describedby': ariaDescribedBy })}
      onBlur={onBlur}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={[
        'icon-button',
        `icon-button--${size}`,
        `icon-button--${variant}`,
        tone === 'danger' ? 'icon-button--danger' : null,
        'ant-btn-icon-only',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      {...dataOnly(dataAttributes)}
      // loading 仍要不可点，但**不能只靠 `:disabled` 表达**：两者语义不同，绑在一起以后就没法只给
      // loading 换色（禁用低对比度可豁免，loading 不行——读者得看出「哪个按钮在忙」）。
      disabled={disabled === true || loading === true}
      data-state={loading === true ? 'loading' : disabled === true ? 'disabled' : undefined}
      icon={
        loading === true ? (
          <LoadingSpinner className="icon-button__glyph" size="sm" />
        ) : (
          <Glyph className="icon-button__glyph" size={GLYPH_PX[size]} aria-hidden="true" />
        )
      }
      onClick={(event) => {
        // 注入的先跑，按钮自己的动作后跑：两条都跑，谁也不吃掉谁。
        onClick?.(event)
        onSelect(event)
      }}
      // 只有真的传了才写：`aria-expanded={undefined}` 在 DOM 里会变成字符串 "undefined"。
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      // 与 `expanded` 同一条：只有真的传了才写。类型上 `hasPopup` 一定伴随 `expanded`，
      // 但运行时这里仍旧分开判断——**类型写对不代表属性出现**，DOM 断言钉的是这一行。
      {...(hasPopup === undefined ? {} : { 'aria-haspopup': hasPopup })}
      {...(controls === undefined ? {} : { 'aria-controls': controls })}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      // 尺寸放在最后：调用方拿得到定位，拿不到覆盖 22/24 的机会。
      style={{ ...style, width: pixels, height: pixels }}
      type={variant === 'plain' ? 'text' : 'default'}
    />
  )

  // 两句都在才算有提示：键与解析后的句子缺一不可（句子为空时平台 `Tooltip` 自己不渲染）。
  if (tooltipKey === undefined || tooltipText === undefined) return button

  // 描述文本由 Tooltip 自己挂到触发元素上（`aria-describedby` 指向弹层），焦点一到弹层就开着，
  // 键盘用户和读屏都拿得到。不自己再挂一份：同一个元素两只手写同一个属性，谁最后写谁生效。
  return (
    <Tooltip labelKey={tooltipKey} resolveText={resolveText}>
      {button}
    </Tooltip>
  )
}
