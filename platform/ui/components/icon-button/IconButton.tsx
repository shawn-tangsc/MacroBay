import { Button, Tooltip } from 'antd'
import type { LucideIcon } from 'lucide-react'
import type { ReactElement } from 'react'

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

/** 两档，仅此两档。名字与 `StateSize` 共用一套词。 */
export const ICON_BUTTON_SIZES = ['sm', 'md'] as const

export type IconButtonSize = (typeof ICON_BUTTON_SIZES)[number]

/** 档位到像素：行内 22、卡片头与工具栏 24（规格 ②）。 */
const SIZE_PX: Record<IconButtonSize, number> = { sm: 22, md: 24 }

/** 图形按档位缩放：行内档 14、工具栏档 16。 */
const GLYPH_PX: Record<IconButtonSize, number> = { sm: 14, md: 16 }

/** 工具栏那一排需要一点底色才不被当成正文，规格里叫 `solid`。 */
export type IconButtonVariant = 'plain' | 'solid'

type IconButtonCommon = {
  /**
   * 读屏名的 i18n 键；不收字面量，也不收已解析好的句子。
   *
   * 开区间是有意的：每个站点的读屏名都不同，平台枚举不出来，硬收成闭集只会逼产品绕过它。
   * 代价是「必填的键」只能在守卫侧保证——`iconButtonKeyGuard.test.ts` 扫源码，含空白或中文即红。
   */
  ariaLabelKey: string
  /** 图标组件（lucide）。装饰图形，本组件负责 `aria-hidden`。 */
  icon: LucideIcon
  /** `sm` = 行内（22），`md` = 卡片头与工具栏（24）。 */
  size: IconButtonSize
  onSelect: () => void
  /** 默认无边框透明底；工具栏用 `solid`。 */
  variant?: IconButtonVariant
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
  icon: Glyph,
  size,
  onSelect,
  disabled,
  tooltipKey,
  variant = 'plain',
  resolveText
}: IconButtonProps): ReactElement {
  const ariaLabel = resolveText(ariaLabelKey)
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
        variant === 'solid' ? 'icon-button--solid' : 'icon-button--plain',
        'ant-btn-icon-only'
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled}
      icon={<Glyph className="icon-button__glyph" size={GLYPH_PX[size]} aria-hidden="true" />}
      onClick={onSelect}
      style={{ width: pixels, height: pixels }}
      type={variant === 'solid' ? 'default' : 'text'}
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
