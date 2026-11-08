import type { ReactElement } from 'react'

import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

/**
 * 「标题旁边那颗 ⓘ」的唯一实现（界面设计 2026-11-08 定的规则）。
 *
 * 分工按**有没有附着物**分，不按句长：
 * - 独立站着的说明图标（本组件）→ `IconButton(sm/plain)` + `Popover`：点击钉住、再点或 Esc 收起；
 * - 挂在已有控件上的一句提示 → `Tooltip`。
 *
 * 为什么不能直接摊在正文里：设置页每一行只许出现「字段名 / 当前值 / 控件 / 状态」四类文本。
 * 一句解释留在正文里，读者扫一行时会把它当成字段或状态读；收进 ⓘ，需要的人仍然拿得到。
 * **注意是移出 DOM，不是用 CSS 藏**——藏着的东西读屏照样念、全选照样复制。
 *
 * 读屏名念「它解释的那个东西 + 说明」（`infoLabelKey`），不是「更多信息」，也不把整段说明当名字；
 * 说明本身由平台 `Popover` 通过 `aria-describedby` 挂在触发件上。
 */
export function SettingInfoPopover(props: Readonly<{
  /** 说明句的键：句子由调用方解析，本组件零文案。 */
  hintKey?: string
  /** 一个 ⓘ 底下挂多句（同一件事的两层说明）时用它；与 `hintKey` 二选一。 */
  hintKeys?: readonly string[]
  /** 触发件的读屏名（「代理设置说明」这类）。 */
  infoLabelKey: string
  resolveText: (key: string) => string
}>): ReactElement {
  return (
    <Popover
      {...(props.hintKeys === undefined
        ? { labelKey: props.hintKey ?? '' }
        : { lines: props.hintKeys.map((key) => ({ labelKey: key })) })}
      resolveText={props.resolveText}
      trigger={(triggerProps) => (
        <IconButton
          onSelect={triggerProps.onSelect}
          onMouseEnter={triggerProps.onMouseEnter}
          onMouseLeave={triggerProps.onMouseLeave}
          onFocus={triggerProps.onFocus}
          onBlur={triggerProps.onBlur}
          expanded={triggerProps.expanded}
          ariaLabelKey={props.infoLabelKey}
          icon={Info}
          size="sm"
          variant="plain"
          resolveText={props.resolveText}
        />
      )}
    />
  )
}
