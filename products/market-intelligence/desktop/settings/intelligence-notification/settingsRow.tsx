import type { ReactElement, ReactNode } from 'react'

/**
 * 设置页的一行（界面规范 v1.10 §8.2）：**一行一件事**。
 *
 * 标签固定 160 在左，控件紧接标签列右边（**左缘对齐**，不是右对齐——右对齐会让每行控件位置
 * 各不相同，整页看着就散）；说明只允许在控件下方**单独一行**，不许和控件挤在同一行里。
 *
 * 这里只写结构，不写间距：间距是这一页的样式实现，改一处 CSS 就全变，不散在各行里。
 */
export function SettingsRow(props: Readonly<{
  label: string
  /** 控件下方的一行说明；没有就不占位。 */
  note?: string
  /** 说明要念给读屏听时传 'status'（例如选完才出现的代价说明）。 */
  noteRole?: 'status'
  /** 组内最后一行不画分隔线。 */
  last?: boolean
  children?: ReactNode
}>): ReactElement {
  return <div className={`intelligence-notification-form-row${props.note === undefined ? '' : ' has-note'}${props.last === true ? ' is-last' : ''}`}>
    <span className="intelligence-notification-form-label">{props.label}</span>
    <div className="intelligence-notification-form-control">
      {props.children}
      {props.note === undefined
        ? null
        : <span className="intelligence-notification-form-note" role={props.noteRole}>{props.note}</span>}
    </div>
  </div>
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
