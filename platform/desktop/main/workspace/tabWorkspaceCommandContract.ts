import type { WorkspaceHostLifecyclePhase } from './panelWorkspacePayloadGuard'

/**
 * Owner: platform/desktop/main/workspace（PLAT-35 组按 PLAT-30 行数纪律从 `tabWorkspaceIpcHandlers.ts` 抽出）。
 *
 * `.tabs.*` 的命令字段白名单与生命周期阶段白名单：常量的**值**逐字未改，抽取只为让 handler 文件专注准入逻辑。
 */
/** 每方法允许的额外字段；`method`/`requestId`/`expectedRevision` 与归属声明是所有命令共有的。 */
export const TAB_COMMAND_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // `pageId` 与 `menuKey` 二者其一（shell 一级菜单键就是 menuKey；两者都是静态公开 id，Main 用它查注册表）
  openTab: ['pageId', 'menuKey', 'bindingKey', 'newInstance'],
  activateTab: ['workspaceInstanceKey'],
  closeTab: ['workspaceInstanceKey'],
  closeOthers: ['workspaceInstanceKey'],
  closeRight: ['workspaceInstanceKey'],
  reopenLastClosed: [],
  reorderTabs: ['workspaceInstanceKeys'],
  detachTab: ['workspaceInstanceKey'],
  redockTab: ['workspaceInstanceKey'],
  bindTab: ['workspaceInstanceKey', 'bindingKey']
})
export const TAB_COMMON_FIELDS = ['method', 'requestId', 'expectedRevision', 'windowInstanceId', 'hostEpoch'] as const
/** 页面窗看得到的阶段：目标侧 ready + 源侧两相（与面板同一词汇，不扩词表）。 */
export const TAB_LIFECYCLE_PHASES: readonly WorkspaceHostLifecyclePhase[] = ['target-ready', 'source-released', 'source-invalid']
