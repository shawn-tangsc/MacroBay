import type { ReactNode } from 'react'

import { builtInWorkspacePages, type BuiltInWorkspacePageId } from '@platform/workspace/registry/builtInWorkspacePages'

/**
 * Owner: apps/desktop-shell renderer / workspace 内置页适配（P2-02）。
 * 权威：派发单「只组合既有内置页面，不实现其业务」。
 *
 * 这里的「适配」= 一级菜单 `pageId` → **既有页面正文** 的唯一派发点：
 *  - 正文仍由状态 owner（AppShell）提供（`AssistantPage`/`AgentPage`/Settings 的既有渲染器都是
 *    本组件树里的真实实现），本文件不复制它们的状态、不重写其持久化；
 *  - 页面集合取平台唯一描述源 `builtInWorkspacePages` 的顺序，shell 不再维护第二份菜单顺序；
 *  - 草稿 owner 接点在 `shell/settings/SettingsWorkspaceAdapter.tsx`；
 *  - P2-03 的 Tab 宿主接同一个派发点，因此不需要再写第二套「哪个 pageId 渲染什么」。
 */

/** 既有内置页正文（由状态 owner 提供；本包只派发，不实现）。 */
export type BuiltInPageMounts = Readonly<Record<BuiltInWorkspacePageId, () => ReactNode>>

export type BuiltInPageAdapters = {
  /** 内置页顺序的唯一来源（平台描述），shell 侧不复制。 */
  list: () => readonly BuiltInWorkspacePageId[]
  /** 派发一个内置页正文；调用方保证 pageId 来自 `list()`。 */
  render: (pageId: BuiltInWorkspacePageId, mounts: BuiltInPageMounts) => ReactNode
}

export function createBuiltInPageAdapters(): BuiltInPageAdapters {
  const order = Object.freeze(builtInWorkspacePages.map((page) => page.pageId))
  return Object.freeze({
    list: () => order,
    render: (pageId: BuiltInWorkspacePageId, mounts: BuiltInPageMounts): ReactNode => mounts[pageId]()
  })
}
