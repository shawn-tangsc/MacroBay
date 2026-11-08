import { Info } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

/**
 * 设置页的一行（界面规范 v1.10 §8.2）：**一行一件事**。
 *
 * 标签固定 160 在左，控件紧接标签列右边（**左缘对齐**，不是右对齐——右对齐会让每行控件位置
 * 各不相同，整页看着就散）。
 *
 * **正文只允许三样东西：字段名、当前值、控件**（用户 2026-11-08 第三次定，原话「描述性说明要我说
 * 几次啊？不要直接这么显示在我的界面上啊」）。所以这一行**没有**放整句说明的位置：说明是给我们
 * 自己看的，读者要的是「这一项是什么、我现在选的是什么」。要解释什么，走 `info`（ⓘ 浮层）。
 *
 * 这条不是靠自觉：`note` / `noteRole` 两个口子已经从类型上删掉，写不进去；`settingsRowBody.test.tsx`
 * 再按渲染结果钉一遍——正文里出现整句就红。
 */
export function SettingsRow(props: Readonly<{
  label: string
  /** 这一行的整句说明：只住进 ⓘ，正文一个字都不留。 */
  info?: SettingsRowInfo
  /** 组内最后一行不画分隔线。 */
  last?: boolean
  children?: ReactNode
}>): ReactElement {
  return <div className={`intelligence-notification-form-row${props.last === true ? ' is-last' : ''}`}>
    <span className="intelligence-notification-form-label">
      {props.label}
      {props.info === undefined ? null : <SettingsInfo {...props.info} />}
    </span>
    <div className="intelligence-notification-form-control">
      {props.children}
    </div>
  </div>
}

export type SettingsRowInfo = Readonly<{
  /** ⓘ 自己的读屏名（它只说明，不继承字段名，否则读屏会念两遍同一个词）。 */
  ariaLabelKey: string
  /** 要说的句子；一行一条，按顺序进浮层。 */
  labelKeys: readonly string[]
  resolveText: (key: string) => string
}>

/**
 * 整句说明的唯一去处：字段名或组标题旁的 ⓘ。
 *
 * 与 `Tooltip` 的分工由平台组件定死：要读一段、要钉住对照就用 `Popover`；这里只负责把
 * 「说明文字」翻译成一颗 `IconButton` 触发器，句子本身仍走调用方的文案表。
 */
export function SettingsInfo(props: SettingsRowInfo): ReactElement {
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

/** 一组字段：组标题 + 行；组与组之间靠 24 间距 + 1px 分隔线分开（首组不带线）。 */
export function SettingsGroup(props: Readonly<{
  title: string
  /** 组标题旁的可选说明（ⓘ），不是正文。 */
  aside?: ReactNode
  children: ReactNode
}>): ReactElement {
  return <section className="intelligence-notification-form-group">
    <div className="intelligence-notification-form-group-head">
      <h3 className="intelligence-notification-form-group-title">{props.title}</h3>
      {props.aside ?? null}
    </div>
    {props.children}
  </section>
}
