import type { ProductManifest } from '@platform/product-manifest'
import { builtInWorkspacePages, builtInWorkspacePageModuleIds } from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry, toProductWorkspacePage } from '@platform/workspace/registry/workspacePageRegistry'

/**
 * Owner: platform/desktop/main/workspace。权威：P2-03 + PLAT-30。
 *
 * 一级菜单页的统一注册（内置三项 + 全部产品菜单页）从组合根抽出：
 * 组合根只接线，注册表构建（含逐贡献 fail-soft）由这里拥有。
 *
 * 只投影纯描述：模块 allowlist 来自内置页 id 与产品页 id（静态、绝不接受 renderer 上报）；
 * 产品页的 `supportsDetached` 缺省即平台默认（Phase 2 每个一级菜单都可分离）。
 * 非法页面贡献只跳过该页（与面板贡献同一姿态），计数由调用方负责（`registrationFailures`）。
 */
export function createComposedPageRegistry(
  productManifests: readonly ProductManifest[],
  productPageIds: readonly string[]
): ReturnType<typeof createWorkspacePageRegistry> {
  const registry = createWorkspacePageRegistry({
    moduleIds: [...builtInWorkspacePageModuleIds, ...productPageIds],
    productIds: productManifests.map((manifest) => manifest.id)
  })
  for (const page of builtInWorkspacePages) registry.register(page)
  for (const manifest of productManifests) {
    for (const page of manifest.shellContributions?.menuPages ?? []) {
      try {
        registry.register(toProductWorkspacePage(manifest.id, {
          id: page.id, title: page.title, icon: page.icon, order: page.order, module: page.module,
          ...(page.workspace === undefined ? {} : { workspace: page.workspace })
        }))
      } catch { /* 非法页面贡献只跳过该页（与面板贡献同一姿态），`registrationFailures` 已在上层计数 */ }
    }
  }
  registry.seal()
  return registry
}
