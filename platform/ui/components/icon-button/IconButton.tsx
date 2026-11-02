import { Button, Tooltip } from 'antd'
import { fillLabelParams } from '../textKeyParams'

import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, MouseEvent, ReactElement } from 'react'

import { LoadingSpinner } from '../loading'

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
  /** 默认无边框透明底；工具栏用 `solid`。 */
  variant?: IconButtonVariant
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
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传键回显）。 */
  resolveText: (key: string) => string
}

export type IconButtonProps = IconButtonCommon &
  (
    | {
        disabled?: false
        /** 需要解释时配可聚焦 Tooltip（不用原生 `title`），文案同样只收键。 */
        tooltipKey?: string
      }
    | {
        /**
         * 禁用态不进 Tab 序列、也接不到 focus，于是 Tooltip 的 `focus` 触发器永远不响——
         * 键盘用户就只剩一个没有理由的灰按钮。所以「禁用 + 提示」这个组合在类型上直接禁掉：
         * 禁用时把原因写成可见说明，别塞进只有鼠标能看见的 Tooltip。
         */
        disabled: true
        tooltipKey?: never
      }
  )

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
  expanded,
  controls,
  className,
  style,
  dataAttributes,
  resolveText
}: IconButtonProps): ReactElement {
  const ariaLabel = fillLabelParams(resolveText(ariaLabelKey), ariaLabelParams)
  const pixels = SIZE_PX[size]
  const tooltipText = tooltipKey === undefined ? undefined : resolveText(tooltipKey)

  // 底子是 antd `Button`：键盘、禁用、`type="button"` 这些行为不该由我们重写一遍。
  // 尺寸、圆角、焦点环仍是我们的规格，写在行内与本地 CSS 里；外观覆盖清单见文档。
  const button = (
    <Button
      aria-label={ariaLabel}
      className={[
        'icon-button',
        `icon-button--${size}`,
        `icon-button--${variant}`,
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
      onClick={onSelect}
      // 只有真的传了才写：`aria-expanded={undefined}` 在 DOM 里会变成字符串 "undefined"。
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(controls === undefined ? {} : { 'aria-controls': controls })}
      // 尺寸放在最后：调用方拿得到定位，拿不到覆盖 22/24 的机会。
      style={{ ...style, width: pixels, height: pixels }}
      type={variant === 'plain' ? 'text' : 'default'}
    />
  )

  if (tooltipText === undefined) return button

  // 描述文本由 Tooltip 自己挂到触发元素上（`aria-describedby` 指向弹层），焦点一到弹层就开着，
  // 键盘用户和读屏都拿得到。不自己再挂一份：同一个元素两只手写同一个属性，谁最后写谁生效。
  return (
    <Tooltip title={tooltipText} trigger={['hover', 'focus']}>
      {button}
    </Tooltip>
  )
}
