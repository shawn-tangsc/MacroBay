import type { WorkspacePageRegistration } from '../contracts'
import { WorkspaceRegistrationPolicy } from '../policies'

/**
 * Owner: platform/workspace/registry。权威：技术设计 §3.3 / §3.4。
 * 内置一级菜单页（Assistant / Agent / Settings）的**唯一描述源**：
 *  - `titleKey` 指向 shell 的 `platformText.nav.*`；平台层不持有第二份可见文案，避免文案漂移；
 *  - `module` 是内置 loader allowlist 里的稳定 id，由 shell 本地 loader 投影解析（绝不由 renderer 上报）；
 *  - Settings 内部二级面板（模型/助手库/网络搜索/…）**不是**一级菜单，不得在这里注册（§3.3）；
 *  - 内置页固定单实例、可分离、无绑定（§3.4）。
 */

export type BuiltInWorkspacePageId = 'assistants' | 'agents' | 'settings'
/** 平台 shell 文案键：必须在 `platformText[language].nav` 下真实存在（shell 侧穷尽映射保证）。 */
export type BuiltInWorkspacePageTitleKey = 'nav.assistants' | 'nav.agents' | 'nav.settings'

export type BuiltInWorkspacePage = WorkspacePageRegistration & {
  pageId: BuiltInWorkspacePageId
  menuKey: BuiltInWorkspacePageId
  titleKey: BuiltInWorkspacePageTitleKey
  title?: undefined
  productId?: undefined
  supportsDetached: true
  allowMultipleInstances: false
}

const noBinding = Object.freeze({
  persistence: 'none' as const,
  maxKeyBytes: WorkspaceRegistrationPolicy.maxBindingKeyBytes
})

export const builtInWorkspacePages: readonly BuiltInWorkspacePage[] = Object.freeze([
  Object.freeze({
    pageId: 'assistants' as const,
    menuKey: 'assistants' as const,
    titleKey: 'nav.assistants' as const,
    icon: 'message-square-text',
    module: 'platform.assistants',
    supportsDetached: true as const,
    allowMultipleInstances: false as const,
    binding: noBinding
  }),
  Object.freeze({
    pageId: 'agents' as const,
    menuKey: 'agents' as const,
    titleKey: 'nav.agents' as const,
    icon: 'bot',
    module: 'platform.agents',
    supportsDetached: true as const,
    allowMultipleInstances: false as const,
    binding: noBinding
  }),
  Object.freeze({
    pageId: 'settings' as const,
    menuKey: 'settings' as const,
    titleKey: 'nav.settings' as const,
    icon: 'settings',
    module: 'platform.settings',
    supportsDetached: true as const,
    allowMultipleInstances: false as const,
    binding: noBinding
  })
])

export const builtInWorkspacePageIds: readonly BuiltInWorkspacePageId[] = Object.freeze(
  builtInWorkspacePages.map((page) => page.pageId)
)

export const builtInWorkspacePageModuleIds: readonly string[] = Object.freeze(
  builtInWorkspacePages.map((page) => page.module)
)
