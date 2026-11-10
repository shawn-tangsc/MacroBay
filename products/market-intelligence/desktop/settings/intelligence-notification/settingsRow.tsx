import type { ReactElement, ReactNode } from 'react'

import { SettingsRow as SharedSettingsRow } from '@platform/ui/components/settings-row'
import { SettingsSection } from '@platform/ui/components/settings-section'

import { SettingsInfo, type SettingsInfoSpec } from '../settingsInfo'

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
  return <SharedSettingsRow
    controlWrapperClassName="intelligence-notification-form-control"
    copyClassName="intelligence-notification-form-label"
    label={<>
      {/* 标题与 ⓘ 同一行：长标题压标题，图标 flex: none 不被挤下去。 */}
      <span className="intelligence-notification-form-label-text">{props.label}</span>
      {props.info === undefined ? null : <SettingsInfo {...props.info} />}
    </>}
    rowClassName={`intelligence-notification-form-row${props.last === true ? ' is-last' : ''}`}>
    {props.children}
  </SharedSettingsRow>
}

export type SettingsRowInfo = SettingsInfoSpec

export { SettingsInfo }

/**
 * 一组字段：区块标题 + 行。
 *
 * 直接交给平台 `SettingsSection`（当前只服务设置页那一面，用默认 `card`）：
 * 组头、ⓘ 槽、分隔线与区块形态都只有那一份实现，这里不再自绘一个「长得像」的。
 */
export function SettingsGroup(props: Readonly<{
  title: string
  /** 组标题旁的可选说明（ⓘ），不是正文。 */
  aside?: ReactNode
  children: ReactNode
}>): ReactElement {
  return <SettingsSection info={props.aside} title={props.title}>{props.children}</SettingsSection>
}
