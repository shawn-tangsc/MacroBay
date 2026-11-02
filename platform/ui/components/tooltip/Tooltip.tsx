import { Tooltip as AntTooltip } from 'antd'
import type { ReactElement } from 'react'

import { fillLabelParams } from '../textKeyParams'
import { overlayContainer } from '../overlayContainer'

/**
 * 可聚焦提示（规格：`docs-private/05-desktop/ui-audit/2026-11-02-tooltip.html`）。
 *
 * 底层是 antd `Tooltip`：**定位、翻转、窗口内夹取**都由它承担，本组件不自己算坐标。
 * 它存在的理由只有一个——原生 `title` 键盘用户根本拿不到：`title` 只跟着鼠标走，
 * 而且不进可访问描述。所以这里的触发器必须是**可聚焦元素**，提示同时挂在 hover 与 focus 上。
 *
 * 几条写进结构与守卫、不靠评审：
 * - 文案只收键（`labelKey`），句子由调用方注入的 `resolveText` 解析；组件内零文案零 i18n；
 * - 未知键解析成**空串时整条提示不渲染**，也不回退键名——把 `ui.tooltip.x` 念给读者是最糟的一种；
 * - 禁用元素不许挂提示：禁用接不到焦点，提示就只剩鼠标能看；这条由类型外的调用点守卫扫，
 *   因为 React 里「元素被禁用」不是一个能从中推导出来的类型；
 * - 悬停 300ms 后出现，**聚焦立即出现**（读者已经明确指向它了，不该再等）。
 */

/*
 * 文案上限（28 个汉字 / 60 个英文字符）是**文档与验收口径**，不设代码常量：
 * 一条「断言常量等于 28」的用例永远通过，它不守护任何真实行为，只会让人以为上限被管住了。
 * 将来真要机械管，扫的是实际句子，不是常量。
 */

/**
 * `K` 由调用方传进来的 `resolveText` 决定：解析器的参数是一组键联合时，`labelKey` 就被锁在那组键里。
 *
 * 这是「静态守卫管字符串、类型系统管传参」里属于类型的那一半（架构师 2026-11-02）：
 * 守卫只能校验写死在调用点的字面量，键放进常量、包一层函数它就看不见；
 * 而只要解析器的类型是键联合，写错键在 `tsc` 阶段就红，跟写法无关。
 *
 * 默认 `string`：还没接键联合的调用点照旧能编译，迁移可以一块一块来。
 */
/**
 * 文案两种来源（契约 §6）：界面上写的句子只收键；**数据**（新闻标题、品种名、regime 名）
 * 走 `dataText`——数据不是文案，逼每条标题造一个键，等于给数据建一张文案表。
 *
 * 两支持互斥（`?: never`）：同时传编译不过。`dataText` 只准来自变量或查询结果，
 * 不许放字面句子：守卫扫字面量，含中文或空白即红。
 *
 * `dataText` 同样受**一行**约束：一条数据一行读得完才用它；读不完（新闻标题常超 44 字符）
 * 改用 `Popover` 的多行说明，别在这里重造一个不带多行结构的 `Popover`。
 */
export type TooltipProps<K extends string = string> = {
  /** 调用方的文案解析入口；未知键返回空串时本组件不渲染提示。 */
  resolveText: (key: K) => string
  /** 触发器：必须是可聚焦元素（按钮、链接、带 tabIndex 的元素），且不可是禁用元素。 */
  children: ReactElement
} & (
  | {
      /** 提示文案的 i18n 键；解析器带键联合时不收联合之外的键。 */
      labelKey: K
      /**
       * 要填进模板的数字或名词，**只收已经格式化好的字符串**（`选中应用名`、`289/289`）。
       *
       * 与 `IconButton.ariaLabelParams`、`Popover.labelParams` 同一套占位符（`{name}`），
       * 也共用同一份填充实现（`../textKeyParams`）。
       */
      labelParams?: Readonly<Record<string, string>>
      dataText?: never
    }
  | {
      labelKey?: never
      labelParams?: never
      /** 整条提示就是一条运行时数据；只准来自变量或查询结果。 */
      dataText: string
    }
)

/**
 * 气泡字号锁死在 12px，不继承外层。
 *
 * antd 的 tooltip 样式里没有写 `font-size`，气泡会跟着正文走：`windowTheme` 的字号一改，
 * 提示就跟着漂。提示是辅助说明，不该随正文字号变——所以这里显式给，并用渲染值断言钉住。
 */
const BUBBLE_STYLE = { fontSize: 12 } as const

/**
 * 定位不接受参数（契约 §6），但它**必须显式写死**：antd 的默认位置是 `top`，不是 `bottom`。
 * 直接把参数删掉，提示会跑到上方——那不是「没设置」，是设置错了。
 *
 * 所以这里是组件内部唯一一处位置，固定 `bottom`，空间不足时由 antd 自动向上翻转。
 * 不导出 `Placement`、不从 props 透传：今天能传 `top`，明天就会有人传 `left`，
 * 再往后就开始自己算坐标——那正是这个组件要收掉的。
 */
const PLACEMENT = 'bottom' as const

export function Tooltip<K extends string = string>(props: TooltipProps<K>): ReactElement {
  const { resolveText, children } = props
  // 数据分支不做占位符填充：数据原样展示，填充只服务于「调用点写的句子」。
  const text =
    props.dataText !== undefined ? props.dataText : fillLabelParams(resolveText(props.labelKey), props.labelParams)

  // 没有句子就不存在提示：空气泡比没有气泡更糟，键名更糟。
  if (text.trim() === '') return children

  return (
    <AntTooltip
      getPopupContainer={overlayContainer}
      mouseEnterDelay={0.3}
      placement={PLACEMENT}
      styles={{ body: BUBBLE_STYLE }}
      title={text}
      trigger={['hover', 'focus']}>
      {children}
    </AntTooltip>
  )
}
