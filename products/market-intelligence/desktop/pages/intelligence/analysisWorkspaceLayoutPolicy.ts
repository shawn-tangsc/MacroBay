/** 产品右侧工作区布局：由产品设计维护，组件键盘及 CSS 回归保护。 */
export const analysisWorkspaceLayoutPolicy = Object.freeze({
  initialChatPercent: 50,
  minChatPercent: 25,
  maxChatPercent: 75,
  keyboardStepPercent: 5,
  percentScale: 100
})

/**
 * 「最新结论卡片」和「节点详情抽屉」都是主显示区表面。
 * 抽屉明确是非模态的：不得渲染遮罩、不得成为 dialog、不得锁滚动，
 * 因为抽屉下方的主看板必须保持可交互。
 */
export const analysisConclusionSurfacePolicy = Object.freeze({
  cardRole: 'region' as const,
  drawerRole: 'complementary' as const,
  drawerHasBackdrop: false,
  drawerModal: false,
  /** 关闭抽屉不得清除时间轴选中态与对话绑定。 */
  closeKeepsSelection: true
})
