/**
 * 浮层挂到哪儿：**一律 `body`**。
 *
 * 触发器常住在会 `overflow: hidden`、会变换、或首帧还没参与布局的壳里（面板帧、抽屉、标签页、
 * 分离窗）。浮层跟着触发器挂，就会被祖先裁掉，或者在祖先还没量出尺寸时拿到 (0,0) 锚点——
 * 2026-11-02 用户报的「气泡显示不了 / 跑到整个应用左上角」正是这两种。
 *
 * 挂到 `body` 之后，位置只由触发器矩形决定，与祖先的裁切和变换无关。这是一个**组件的固有行为**，
 * 不是调用点选项：`Tooltip` 与 `Popover` 都写死它，不透传，也不新增 `getPopupContainer` 参数——
 * 一旦可以传，第一个传回“挂在触发器旁边”的站点就会把同一类问题带回来，而它在开发机上多半看不见。
 */
export function overlayContainer(node: HTMLElement): HTMLElement {
  return node.ownerDocument.body
}
