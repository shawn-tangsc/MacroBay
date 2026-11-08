import { Info } from 'lucide-react'
import type { ReactElement } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

/**
 * 整句说明的唯一去处：字段名或组标题旁的 ⓘ。
 *
 * 设置页的正文只允许三样东西——**字段名、当前值、控件**（外加「存不上」「读不到」这类状态）。
 * 任何解释、范围、代价性的句子都住在这里：用户 2026-11-08 第三次为这件事发火，原话是
 * 「描述性说明要我说几次啊？不要直接这么显示在我的界面上啊」。
 *
 * 放在 `settings/` 根上，是因为两个设置页（情报通知、情报源 / 运行记录）都要用它——各写一颗
 * ⓘ 就是两套实现，迟早一处有 Esc 回焦点、另一处没有。
 *
 * **只收键**（与平台 `IconButton` 同一条规矩）：句子由调用方的 `resolveText` 解析，键怎么来由
 * 调用方决定——手里是页内文案表就直接查，手里是产品文案树就把那几条键写成一张小表。
 */
export function SettingsInfo(props: SettingsInfoSpec): ReactElement {
  return <Popover
    lines={props.labelKeys.map((labelKey) => ({ labelKey }))}
    resolveText={props.resolveText}
    trigger={(triggerProps) => (
      <IconButton
        {...triggerProps}
        ariaLabelKey={props.ariaLabelKey}
        icon={Info}
        resolveText={props.resolveText}
        size="sm"
        variant="plain"
      />
    )}
  />
}

export type SettingsInfoSpec = Readonly<{
  /** ⓘ 自己的读屏名（它只说明，不继承字段名，否则读屏会念两遍同一个词）。 */
  ariaLabelKey: string
  /** 要说的句子；一行一条，按顺序进浮层。 */
  labelKeys: readonly string[]
  resolveText: (key: string) => string
}>
