import type { ReactNode } from 'react'

/**
 * 抽屉的**内容卡**：右侧正文整块是一张卡，七个屏都渲染在它里面（骨架一处，不逐屏包）。
 *
 * 数值照界面设计那张表（`2026-11-11-settings-drawer-skeleton-numbers.md`）：
 * 圆角 8、1px `--border`、`--surface` 底、高 100%；**卡头不滚、卡体是唯一滚动容器**；
 * 卡头 padding `16 16 12` + 页名 16/1.35/650。短内容屏也撑满 100%、内容顶对齐，
 * 所以切菜单时卡框、边距、页名基线都不动。
 *
 * 已知补丁：`SettingsSection` 现在自带「卡」样式（1px 边 + 圆角 + surface 底），卡里再套就是双框；
 * `configDrawer.css` 里用作用域覆盖把它压平，等它出 flat 变体后删掉那条覆盖。
 */
export function ConfigDrawerContentCard({ title, children, split }: Readonly<{
  /** 页名（当前菜单项的文案），卡头那一行。 */
  title: string
  /** 分栏屏：卡体按两栏排，不套单列。 */
  split?: boolean
  children: ReactNode
}>): React.ReactElement {
  return <div className="config-drawer__card" data-drawer-card="true">
    <div className="config-drawer__card-head">
      <h2 className="config-drawer__card-title">{title}</h2>
    </div>
    <div className={`config-drawer__card-body${split === true ? ' config-drawer__card-body--split' : ''}`}>
      {children}
    </div>
  </div>
}
