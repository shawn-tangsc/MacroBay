import type { ReactNode } from 'react'

/**
 * 抽屉的**内容卡**：右侧正文整块是一张卡，七个屏都渲染在它里面（骨架一处，不逐屏包）。
 *
 * 用户原话：「把现在的内容给我放到一个标准的内容卡片里面，其他不变」。所以这里**只有一层壳**：
 * 圆角 8、1px `--border`、`--surface` 底、高 100%、内距 16；**卡体是唯一滚动容器**。
 * **卡头页名已删**（左边菜单已经高亮当前屏，卡头再写一遍是重复）。
 * 短内容屏也撑满 100%、内容顶对齐，切菜单时卡框不动。
 *
 * 已知补丁：`SettingsSection` 现在自带「卡」样式（1px 边 + 圆角 + surface 底），卡里再套就是双框；
 * `configDrawer.css` 里用作用域覆盖把它压平，等它出 flat 变体后删掉那条覆盖。
 */
export function ConfigDrawerContentCard({ children, split }: Readonly<{
  /** 分栏屏：卡体按两栏排，不套单列。 */
  split?: boolean
  children: ReactNode
}>): React.ReactElement {
  return <div className="config-drawer__card" data-drawer-card="true">
    <div className={`config-drawer__card-body${split === true ? ' config-drawer__card-body--split' : ''}`}>
      {children}
    </div>
  </div>
}
